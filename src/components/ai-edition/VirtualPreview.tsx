import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type CropRegion,
	DEFAULT_CROP_REGION,
	MAX_NATIVE_PLAYBACK_RATE,
} from "@/components/video-editor/types";
import { resolvePlaybackSegments } from "@/lib/ai-edition/document/timeline";
import type { AxcutClip, AxcutTrimRange, AxcutZoomRegion } from "@/lib/ai-edition/schema";
import { usePreviewPerformancePolicy } from "@/lib/ai-edition/store/previewPerformance";
import { useEditorSettings } from "@/lib/ai-edition/store/useEditorSettings";
import type { PlaybackClockRef } from "@/lib/ai-edition/timeline/playback-clock";
import { findActiveSpeedRegion, type SpeedRegion } from "@/lib/ai-edition/timeline/speed";
import {
	clampVirtualTime,
	createPlaybackIndex,
	findNextKeptSegmentIndexed,
	locateKeptSegmentIndexed,
	locateRawSourcePosition,
	locateVirtualPosition,
	rawClipForSegment,
	rawVirtualStartForSegment,
	totalVirtualDuration,
} from "@/lib/ai-edition/timeline/virtual-preview";
import {
	computePreparedZoomPreviewTransform,
	IDENTITY_ZOOM_TRANSFORM,
	prepareZoomPreviewRegions,
} from "@/lib/ai-edition/timeline/zoom-preview";
import { CursorDomOverlay } from "./CursorDomOverlay";
import styles from "./VirtualPreview.module.css";

export interface VideoSource {
	id: string;
	src: string;
	label: string;
	sourcePath?: string;
}

/** First clip (by timeline order) starting strictly after `afterTimelineStartSec` —
 *  independent of the `clips` array's own order, which is never guaranteed to match
 *  timeline order (a clip can be inserted/reordered at any array index; only
 *  `timelineStartSec` is authoritative). Shared by every clip-boundary-advance path
 *  (rAF tick, the `<video>` `ended` event) so they all agree on "the next clip". */
function findNextClipByTimelineOrder(
	clips: AxcutClip[],
	afterTimelineStartSec: number,
): AxcutClip | undefined {
	return clips
		.filter((clip) => clip.timelineStartSec > afterTimelineStartSec + 0.001)
		.sort((a, b) => a.timelineStartSec - b.timelineStartSec)[0];
}

interface VirtualPreviewProps {
	videoSources: VideoSource[];
	clips: AxcutClip[];
	zoomRegions?: AxcutZoomRegion[];
	speedRegions?: SpeedRegion[];
	trimRanges?: AxcutTrimRange[];
	seekTarget?: { timeSec: number; isSource?: boolean; requestId: number } | null;
	onTimeChange?: (timeSec: number) => void;
	onLoadedMetadata?: (
		durationSec: number,
		assetId: string,
		videoWidth: number,
		videoHeight: number,
	) => void;
	onVideoElement?: (element: HTMLVideoElement | null) => void;
	videoStyle?: React.CSSProperties;
	/** Called with the id of the asset that failed, not as a bare "the preview is
	 *  broken" signal: only ONE source is mounted at a time (`activeSource`), so
	 *  the caller has no other way to tell which of its sources is dead. */
	onVideoError?: (assetId: string) => void;
	/** Crop of the active clip, as fractions (0-1) of the source frame. Absent/
	 * identity ({x:0,y:0,width:1,height:1}) renders the full frame, unchanged
	 * from before crop support existed. */
	cropRegion?: CropRegion | null;
	/**
	 * Written every rAF tick with this video's live position/rate so other
	 * media elements (the webcam overlay) can read it directly instead of
	 * waiting for a React state round trip. See playback-clock.ts.
	 */
	clockRef?: PlaybackClockRef;
}

export function VirtualPreview({
	videoSources,
	clips,
	zoomRegions = [],
	speedRegions = [],
	trimRanges = [],
	seekTarget,
	onTimeChange,
	onLoadedMetadata,
	onVideoElement,
	videoStyle,
	onVideoError,
	cropRegion,
	clockRef,
}: VirtualPreviewProps) {
	const { settings } = useEditorSettings();
	const previewPolicy = usePreviewPerformancePolicy();
	// ponytail: an oversized, offset video inside .videoFrame's overflow:hidden
	// box — the same "scale + negative-position the full frame, let the
	// container clip the rest" technique the export renderer uses via a Pixi
	// sprite offset (frameRenderer.ts's updateLayout). Percentages here
	// resolve against .videoFrame's own (already crop-corrected, see
	// PreviewCanvas's screenSize) box, so this stays correct at any size
	// without measuring pixels. Identity crop reduces to 100%/100%/0/0 — the
	// exact same box the video rendered in before crop support existed.
	const region = cropRegion ?? DEFAULT_CROP_REGION;
	const isIdentityCrop =
		region.x === 0 && region.y === 0 && region.width === 1 && region.height === 1;
	const cropVideoStyle: React.CSSProperties = isIdentityCrop
		? {}
		: {
				position: "absolute",
				width: `${100 / region.width}%`,
				height: `${100 / region.height}%`,
				left: `${(-region.x * 100) / region.width}%`,
				top: `${(-region.y * 100) / region.height}%`,
			};
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const videoFrameRef = useRef<HTMLDivElement | null>(null);

	const isProgrammaticSeekRef = useRef(false);
	const pendingSeekRef = useRef<{ sourceTimeSec: number; play: boolean } | null>(null);
	// Which clip the rAF tick below believes is currently playing — set
	// whenever a seek unambiguously resolves one (via locateVirtualPosition,
	// timeline position → clip). Passed back into locateSourcePosition so
	// two clips that share the same source asset (and possibly the same
	// source range) don't get conflated: without this, resolving "current
	// clip" from (assetId, sourceTime) alone always picks the earliest
	// matching clip, even while a later one is the one actually playing.
	const activeClipIdRef = useRef<string | null>(null);
	const [virtualTimeSec, setVirtualTimeSec] = useState(0);
	const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
	const [sourceIndex, setSourceIndex] = useState(0);

	const virtualDurationSec = useMemo(() => totalVirtualDuration(clips), [clips]);
	const activeSource = videoSources[sourceIndex] ?? null;

	// Drive visual presentation from an independent 60 Hz display clock. Screen
	// recordings are commonly VFR, so requestVideoFrameCallback can pause for tens or
	// hundreds of milliseconds while a held media frame is still on screen. Zoom,
	// cursor and camera motion must continue against the video's logical currentTime.
	// ponytail: the rAF closure captured the props at mount time. The
	// auto-created clip arrives a tick after the source swaps, so reads
	// from the closure would forever see `clips: []` and the rAF would
	// bail at the `clips.length === 0` guard — leaving the scrub thumb
	// stuck at 0% and the drag range at `max=1`. The refs let the rAF
	// always see the latest values without re-creating on every clip
	// mutation.
	const clipsRef = useRef(clips);
	clipsRef.current = clips;
	// Trim-narrowed (`resolvePlaybackSegments`) — used ONLY to detect "has the <video>'s own
	// currentTime drifted into a trim" and where to jump it back out to. Everything ELSE in
	// this component (`clips`/`clipsRef` above, virtualTimeSec, zoom/speed region lookups,
	// what gets reported via `onTimeChange`) stays on the RAW/document timeline — the same
	// coordinate space the ruler, zoom/speed regions, and the trim marker itself use. Keeping
	// these two lists separate (rather than swapping `clips` itself to the trim-narrowed one)
	// is what makes the reported playhead jump OVER a trim marker instead of drifting out of
	// sync with it: `locateSourcePosition` below, fed RAW clips, maps the underlying video's
	// source time to a RAW virtual time that jumps discontinuously by exactly the trim's
	// width the moment the video itself jumps — matching the marker's own pixel span.
	const playbackClips = useMemo(
		() => resolvePlaybackSegments(clips, trimRanges),
		[clips, trimRanges],
	);
	const playbackIndex = useMemo(
		() => createPlaybackIndex(clips, playbackClips),
		[clips, playbackClips],
	);
	const playbackIndexRef = useRef(playbackIndex);
	playbackIndexRef.current = playbackIndex;
	const videoSourcesRef = useRef(videoSources);
	videoSourcesRef.current = videoSources;
	const sourceIndexRef = useRef(sourceIndex);
	sourceIndexRef.current = sourceIndex;
	const virtualTimeSecRef = useRef(virtualTimeSec);
	useEffect(() => {
		virtualTimeSecRef.current = virtualTimeSec;
	}, [virtualTimeSec]);
	const virtualDurationSecRef = useRef(virtualDurationSec);
	virtualDurationSecRef.current = virtualDurationSec;
	const speedRegionsRef = useRef(speedRegions);
	speedRegionsRef.current = speedRegions;
	const preparedZoomRegions = useMemo(() => prepareZoomPreviewRegions(zoomRegions), [zoomRegions]);
	// Same reasoning as `clipsRef` above, for the one thing the rAF calls rather than reads:
	// `seekToVirtualTime` is a `useCallback` whose deps include `clips`, so it takes a new
	// identity on every clip mutation — a REORDER included. The rAF below is deliberately
	// re-created only when the active source swaps, so calling that callback straight from
	// the closure pins it to the clip order current at the last asset swap. The tick would
	// then pick the RIGHT next clip (it reads `clipsRef.current`, always fresh) and hand its
	// timeline time to a `locateVirtualPosition` resolving against the STALE layout, landing
	// on whichever clip used to occupy that position — the one that just played. That is the
	// "playback stops at the junction and jumps back to the start of the clip it just
	// finished, but only after reordering" bug: with no reorder both arrays are identical, so
	// nothing shows. Assigned after the callback exists, below; read through the ref here so
	// the tick always invokes the latest closure.
	const seekToVirtualTimeRef = useRef<
		((nextVirtualTimeSec: number, preservePlayback?: boolean, forceResume?: boolean) => void) | null
	>(null);
	const lastUiUpdateMsRef = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-create the rAF when the active source swaps.
	useEffect(() => {
		let raf = 0;
		let disposed = false;
		const scheduledVideo = videoRef.current;
		const scheduleNext = () => {
			if (disposed || raf !== 0) return;
			raf = window.requestAnimationFrame(tick);
		};
		const tick = () => {
			raf = 0;
			if (disposed) return;
			const v = videoRef.current;
			if (!v) return;
			// Metadata can become ready a frame or two after the play event. Keep the
			// visual loop alive while playing so a transient invalid currentTime cannot
			// permanently stall presentation until the next pause/play cycle.
			if (!v.paused) scheduleNext();
			if (!Number.isFinite(v.currentTime)) return;
			const activeSourceId = videoSourcesRef.current[sourceIndexRef.current]?.id;
			const activeRawClipIndex = activeClipIdRef.current
				? playbackIndexRef.current.raw.indexById.get(activeClipIdRef.current)
				: undefined;
			const activeRawClip =
				activeRawClipIndex === undefined
					? undefined
					: playbackIndexRef.current.raw.clips[activeRawClipIndex];
			// Publish this frame's live position/rate for other media elements
			// (webcam) to read directly — see playback-clock.ts for why this
			// bypasses React state entirely.
			if (clockRef) {
				clockRef.current.sourceTimeSec = v.currentTime;
				clockRef.current.isPlaying = !v.paused;
				clockRef.current.playbackRate = v.playbackRate;
				clockRef.current.virtualTimeSec = virtualTimeSecRef.current;
				clockRef.current.activeClipId = activeRawClip?.id ?? null;
				clockRef.current.activeAssetId = activeRawClip?.assetId ?? activeSourceId ?? null;
			}
			// Trims only trim ahead during actual playback — scrubbing/paused seeks are
			// intentionally NOT clamped, so the user can navigate freely into a trim while
			// editing; only Play/export treats it as a cut (mirrors the pre-existing intent
			// this replaces). Jump is on the SOURCE clock only: the RAW virtual-time report
			// below (locateSourcePosition against `clipsRef.current`, unchanged) naturally
			// jumps by the trim's exact width the instant `v.currentTime` does, so the ruler's
			// playhead visually skips the trim marker instead of drifting through it.
			if (!v.paused) {
				// Resolved against the segments of the clip we are ACTUALLY playing (see
				// `locateKeptSegment`). Asking the whole segment list — all this could do
				// before a trim named its clip — let a twin clip over the same recording
				// answer "yes, that stretch is kept" for a cut authored on this one, so the
				// cut was simply not skipped during playback.
				const inKeptSegment = locateKeptSegmentIndexed(
					playbackIndexRef.current,
					v.currentTime,
					activeSourceId,
					activeClipIdRef.current ?? undefined,
				);
				if (!inKeptSegment) {
					const nextKeptSegment = findNextKeptSegmentIndexed(
						playbackIndexRef.current,
						virtualTimeSecRef.current,
						activeSourceId,
						v.currentTime,
						activeClipIdRef.current ?? undefined,
					);
					if (nextKeptSegment) {
						// `findRawClipForSegment` is the ONE definition of the segment-id
						// convention `resolvePlaybackSegments` emits; this used to re-implement
						// it verbatim, which is precisely the second reader that definition
						// exists to prevent.
						const rawClip = rawClipForSegment(playbackIndexRef.current, nextKeptSegment);
						if (rawClip) {
							activeClipIdRef.current = rawClip.id;
						}
						const rawTargetTime = rawVirtualStartForSegment(
							playbackIndexRef.current,
							nextKeptSegment,
						);
						seekToVirtualTimeRef.current?.(rawTargetTime, true);
						return;
					}
					v.pause();
					updateVirtualTime(virtualDurationSecRef.current);
					return;
				}
			}
			// À L'ARRÊT, le `<video>` ne pilote PLUS la position de la timeline.
			//
			// Ce tick publie `updateVirtualTime(...)` dérivé de `v.currentTime`. Pendant la
			// lecture c'est la bonne source : le média avance, la tête le suit. À l'arrêt
			// c'est l'inverse — l'utilisateur possède la tête de lecture, et le `<video>`
			// doit la SUIVRE. Sans ce garde, un scrub était écrasé à chaque frame par la
			// position d'un élément encore en train de chercher ; et près d'une frontière de
			// clips, `locateSourcePosition` ne résolvait pas, si bien que le repli
			// `seekToVirtualTimeRef(nextClip.timelineStartSec)` plus bas renvoyait la tête au
			// DÉBUT du clip voisin — le tressaillement observé au passage d'un clip à l'autre.
			//
			// Pause/seek/rate events publish the still position explicitly. Do not wake
			// every visual subscriber on every idle rAF tick.
			if (v.paused) {
				return;
			}
			if (clipsRef.current.length === 0) {
				// ponytail: no clip yet (auto-create runs from
				// handleLoadedMetadata on the next tick). Push the raw
				// source time as the virtual time so the scrub thumb
				// advances and the timecode shows real progress during
				// playback. The proper timeline-aware mapping kicks in
				// when the auto-created clip arrives.
				virtualTimeSecRef.current = v.currentTime;
				if (clockRef) {
					clockRef.current.virtualTimeSec = v.currentTime;
					clockRef.publish();
				}
				const now = performance.now();
				if (now - lastUiUpdateMsRef.current >= 1000 / previewPolicy.uiFps - 1) {
					lastUiUpdateMsRef.current = now;
					updateVirtualTime(v.currentTime);
				}
				return;
			}
			if (isProgrammaticSeekRef.current) {
				isProgrammaticSeekRef.current = false;
				const pos = locateRawSourcePosition(
					playbackIndexRef.current,
					v.currentTime,
					activeSourceId,
					0.05,
					activeClipIdRef.current ?? undefined,
				);
				if (pos) {
					activeClipIdRef.current = pos.clip.id;
					if (clockRef) {
						clockRef.current.activeClipId = pos.clip.id;
						clockRef.current.activeAssetId = pos.clip.assetId;
					}
					updateVirtualTime(clampVirtualTime(clipsRef.current, pos.virtualTimeSec));
				}
				return;
			}
			const position = locateRawSourcePosition(
				playbackIndexRef.current,
				v.currentTime,
				activeSourceId,
				0.05,
				activeClipIdRef.current ?? undefined,
			);
			if (!position) {
				// ponytail: fall back to timeline order so cross-asset / reordered
				// clips don't keep playing unmapped media.
				const nextClip = findNextClipByTimelineOrder(clipsRef.current, virtualTimeSecRef.current);
				if (nextClip) seekToVirtualTimeRef.current?.(nextClip.timelineStartSec, true);
				else {
					v.pause();
					updateVirtualTime(virtualDurationSecRef.current);
				}
				return;
			}
			activeClipIdRef.current = position.clip.id;
			const reachedClipEnd = v.currentTime >= (position.clip.sourceEndSec ?? Infinity) - 0.04;
			if (reachedClipEnd) {
				// BUG corrigé : `clipsRef.current[position.clipIndex + 1]` supposait que le
				// tableau brut (`document.timeline.clips`, jamais trié) était déjà dans l'ordre
				// temporel — s'il ne l'était pas (clip ajouté/splitté à un index qui ne reflète
				// pas son `timelineStartSec`), ce lookup retournait `undefined` même quand un
				// clip suivant existait bel et bien, ce qui déclenchait un arrêt de la lecture
				// au lieu d'enchaîner — le "ça se stoppe en fin de clip" observé. Recherche par
				// temps de timeline (comme le fallback juste au-dessus et
				// `NativeCompositorOverlay`), indépendante de l'ordre du tableau.
				const nextClip = findNextClipByTimelineOrder(
					clipsRef.current,
					position.clip.timelineStartSec,
				);
				if (!nextClip) {
					v.pause();
					updateVirtualTime(virtualDurationSecRef.current);
					return;
				}
				seekToVirtualTimeRef.current?.(nextClip.timelineStartSec, true);
				return;
			}
			const nextVirtualTime = clampVirtualTime(clipsRef.current, position.virtualTimeSec);
			virtualTimeSecRef.current = nextVirtualTime;
			const activeSpeedRegion = findActiveSpeedRegion(
				speedRegionsRef.current,
				Math.round(nextVirtualTime * 1000),
			);
			const nextPlaybackRate = Math.min(activeSpeedRegion?.speed ?? 1, MAX_NATIVE_PLAYBACK_RATE);
			if (v.playbackRate !== nextPlaybackRate) v.playbackRate = nextPlaybackRate;
			if (clockRef) {
				clockRef.current.virtualTimeSec = nextVirtualTime;
				clockRef.current.playbackRate = v.playbackRate;
				clockRef.current.activeClipId = position.clip.id;
				clockRef.current.activeAssetId = position.clip.assetId;
				clockRef.publish();
			}
			const now = performance.now();
			if (now - lastUiUpdateMsRef.current >= 1000 / previewPolicy.uiFps - 1) {
				lastUiUpdateMsRef.current = now;
				updateVirtualTime(nextVirtualTime);
			}
		};
		scheduledVideo?.addEventListener("play", scheduleNext);
		scheduleNext();
		return () => {
			disposed = true;
			scheduledVideo?.removeEventListener("play", scheduleNext);
			window.cancelAnimationFrame(raf);
		};
		// re-create the rAF when the active source swaps (by asset id, not src —
		// two clips can point at distinct assets that resolve to the same URL).
	}, [activeSource?.id, previewPolicy.uiFps]);

	// report the video element up; re-notify (and clear) whenever the active
	// source changes so the parent doesn't keep a stale node after the keyed
	// <video> is swapped for a new asset.
	const activeSourceKey = activeSource?.id ?? null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on source swap
	useEffect(() => {
		onVideoElement?.(videoRef.current);
		return () => onVideoElement?.(null);
	}, [onVideoElement, activeSourceKey]);

	const updateVirtualTime = useCallback(
		(nextTimeSec: number) => {
			virtualTimeSecRef.current = nextTimeSec;
			setVirtualTimeSec(nextTimeSec);
			onTimeChange?.(nextTimeSec);
			// ponytail: mirrors main's per-frame `video.playbackRate = ...`
			// (videoEventHandlers.ts) — the browser does the actual time
			// warping, so this is the only thing speed regions need. No
			// virtual-timeline remap: a sped-up region still occupies its
			// original span on the ruler, it's just played through faster.
			const v = videoRef.current;
			if (v) {
				const activeRegion = findActiveSpeedRegion(
					speedRegionsRef.current,
					Math.round(nextTimeSec * 1000),
				);
				// Clamp to the browser's 16× playbackRate ceiling; >16× is rendered at
				// its true speed only on the offline export path, not the live preview.
				const rate = Math.min(activeRegion?.speed ?? 1, MAX_NATIVE_PLAYBACK_RATE);
				if (v.playbackRate !== rate) v.playbackRate = rate;
			}
		},
		[onTimeChange],
	);

	// Apply zoom directly from the visual clock. Store/UI time can be 30/15 Hz,
	// but the final video surface must never inherit that lower cadence.
	useEffect(() => {
		const frame = videoFrameRef.current;
		if (!frame) return;
		const paint = () => {
			const visualTimeSec = clockRef?.current.virtualTimeSec ?? virtualTimeSecRef.current;
			const activeSpeedRegion = findActiveSpeedRegion(
				speedRegionsRef.current,
				Math.round(visualTimeSec * 1000),
			);
			const playbackRate = activeSpeedRegion?.speed ?? 1;
			const transform =
				preparedZoomRegions.length === 0
					? IDENTITY_ZOOM_TRANSFORM
					: computePreparedZoomPreviewTransform(
							preparedZoomRegions,
							visualTimeSec * 1000,
							undefined,
							playbackRate,
							settings.screenAnimationStyle,
						);
			frame.style.transform = `translate(${transform.translateXPercent}%, ${transform.translateYPercent}%) scale(${transform.scale})`;
		};
		paint();
		return clockRef?.subscribe(paint);
	}, [clockRef, preparedZoomRegions, settings.screenAnimationStyle]);

	const seekToVirtualTime = useCallback(
		(nextVirtualTimeSec: number, preservePlayback = false, forceResume = false) => {
			const position = locateVirtualPosition(clips, nextVirtualTimeSec);
			if (!position) {
				videoRef.current?.pause();
				updateVirtualTime(0);
				return;
			}
			activeClipIdRef.current = position.clip.id;

			const targetIndex = videoSources.findIndex((vs) => vs.id === position.clip.assetId);
			const isAssetSwitch = targetIndex >= 0 && targetIndex !== sourceIndex;
			// Read the live paused state, not the captured `isPlaying` prop. The prop is the
			// parent's playback state as of the last render, and a boundary advance can fire
			// on the very frame playback starts or stops — before that state has round-tripped
			// back down. Only the DOM's own `paused` flag is guaranteed current at call time.
			// (This used to be strictly worse: the rAF invoked a closure captured when the rAF
			// was created, before playback started, so `isPlaying` was permanently stale-false
			// and the cross-asset resume never fired at all. The rAF now calls through
			// `seekToVirtualTimeRef`, so the closure itself is fresh — see its declaration.)
			//
			// `forceResume` bypasses that live check for the ONE caller where it's
			// actively wrong: the `<video>` `ended` handler. The browser sets
			// `.paused = true` synchronously before firing `ended`, so by the time
			// that handler runs and calls us, `!videoRef.current?.paused` is always
			// false — even though playback was genuinely still going and should
			// continue into the next clip. Without this, a non-trimmed clip (whose
			// file's real end coincides with its timeline window's end) would win a
			// race against the rAF tick's own boundary check: the native `ended`
			// event fires first, stops playback outright, and the multi-clip
			// timeline never advances — the "stops at clip end" bug.
			const shouldContinuePlayback = preservePlayback && (forceResume || !videoRef.current?.paused);

			if (isAssetSwitch) {
				setSourceIndex(targetIndex);
				setLoadState("loading");
				updateVirtualTime(position.virtualTimeSec);
				pendingSeekRef.current = {
					sourceTimeSec: position.sourceTimeSec,
					play: shouldContinuePlayback,
				};
				return;
			}

			const video = videoRef.current;
			if (!video) return;

			isProgrammaticSeekRef.current = true;
			updateVirtualTime(position.virtualTimeSec);
			if (Math.abs(video.currentTime - position.sourceTimeSec) > 0.01) {
				video.currentTime = position.sourceTimeSec;
			}
			if (shouldContinuePlayback) {
				// A rejection here means playback never actually started, so the browser
				// never fired 'play' — nothing to reconcile, just avoid an unhandled
				// rejection warning.
				void video.play().catch(() => {
					// swallow: rejection just means playback never started
				});
			}
		},
		[clips, videoSources, sourceIndex, updateVirtualTime],
	);

	const seekToSourceTime = useCallback((sourceTimeSec: number) => {
		const video = videoRef.current;
		if (!video) return;
		isProgrammaticSeekRef.current = true;
		if (Math.abs(video.currentTime - sourceTimeSec) > 0.01) {
			video.currentTime = sourceTimeSec;
		}
	}, []);

	const publishPlaybackState = useCallback(
		(video: HTMLVideoElement) => {
			if (!clockRef) return;
			clockRef.current.sourceTimeSec = video.currentTime;
			clockRef.current.virtualTimeSec = virtualTimeSecRef.current;
			clockRef.current.isPlaying = !video.paused;
			clockRef.current.playbackRate = video.playbackRate;
			const activeClipIndex = activeClipIdRef.current
				? playbackIndexRef.current.raw.indexById.get(activeClipIdRef.current)
				: undefined;
			const activeClip =
				activeClipIndex === undefined
					? undefined
					: playbackIndexRef.current.raw.clips[activeClipIndex];
			clockRef.current.activeClipId = activeClip?.id ?? null;
			clockRef.current.activeAssetId =
				activeClip?.assetId ?? videoSourcesRef.current[sourceIndexRef.current]?.id ?? null;
			clockRef.publish();
		},
		[clockRef],
	);

	// BUG corrigé : cet effet listait `seekToVirtualTime`/`seekToSourceTime` en dépendances
	// — mais `seekToVirtualTime` change d'identité (nouveau `useCallback`) à chaque fois que
	// `sourceIndex` change, y compris quand CE MÊME effet vient de le faire changer (switch
	// d'asset lors d'un enchaînement de clip). Résultat : l'effet se redéclenchait alors
	// qu'AUCUN nouveau seek n'avait été demandé, et réappliquait l'ANCIEN `seekTarget` (la
	// position du dernier scrub manuel) — rebasculant sur le clip d'origine et figeant la
	// lecture pile à cette position. D'où le "ça se fige à la fin du 1er clip, uniquement si
	// la tête de lecture avait été déplacée avant" : sans scrub préalable, `seekTarget` reste
	// `null` et l'effet est un no-op, masquant le bug. Seul `seekTarget` (son `requestId`)
	// doit déclencher un nouveau seek ; les fonctions elles-mêmes sont lues via des refs
	// tenues à jour à chaque rendu, pour ne jamais rejouer un ancien seek par accident.
	// (`seekToVirtualTimeRef` is declared above the rAF effect — see the comment there — so
	// the boundary-advance path reads the same always-fresh closure this effect does.)
	seekToVirtualTimeRef.current = seekToVirtualTime;
	const seekToSourceTimeRef = useRef(seekToSourceTime);
	seekToSourceTimeRef.current = seekToSourceTime;
	useEffect(() => {
		if (!seekTarget) return;
		if (seekTarget.isSource) {
			seekToSourceTimeRef.current(seekTarget.timeSec);
		} else {
			seekToVirtualTimeRef.current?.(seekTarget.timeSec);
		}
	}, [seekTarget]);

	return (
		<div className={styles.container}>
			{activeSource ? (
				<>
					<div ref={videoFrameRef} className={styles.videoFrame}>
						<video
							// Key on the asset id, not the URL: distinct assets that resolve
							// to the same file URL must still remount the <video> on switch so
							// onLoadedMetadata refires and the pending cross-asset seek/resume
							// runs (otherwise playback stalls at the clip boundary).
							key={activeSource.id}
							ref={videoRef}
							src={activeSource.src}
							className={`${styles.video}${isIdentityCrop ? "" : ` ${styles.videoCropped}`}`}
							// When a synthetic cursor is being drawn on top (CursorPreviewLayer),
							// hide the real OS pointer here so it doesn't compete with it.
							style={{
								...cropVideoStyle,
								...videoStyle,
								cursor: settings.cursorShow ? "none" : undefined,
							}}
							preload="metadata"
							playsInline
							onPlay={(event) => publishPlaybackState(event.currentTarget)}
							onPause={(event) => publishPlaybackState(event.currentTarget)}
							onRateChange={(event) => publishPlaybackState(event.currentTarget)}
							onSeeked={(event) => publishPlaybackState(event.currentTarget)}
							onLoadedMetadata={(e) => {
								setLoadState("ready");
								publishPlaybackState(e.currentTarget);
								// ponytail: forward the raw duration (possibly NaN for
								// MediaRecorder WebMs) to the parent. handleLoadedMetadata
								// falls back to a 60s seed when it isn't finite so the
								// timeline gets a populated clip even before the EBML fix
								// lands. Previously this gate skipped the callback for
								// non-finite durations and stranded the editor on
								// "No clips yet" until manual intervention. The assetId is
								// forwarded so the parent only ever corrects clips that
								// belong to the asset which actually fired this event —
								// without it, switching between clips of different assets
								// during multi-clip playback clobbered clip[0]'s duration
								// with whichever asset's video happened to load last.
								onLoadedMetadata?.(
									e.currentTarget.duration,
									activeSource.id,
									e.currentTarget.videoWidth,
									e.currentTarget.videoHeight,
								);
								if (pendingSeekRef.current) {
									const { sourceTimeSec, play } = pendingSeekRef.current;
									pendingSeekRef.current = null;
									e.currentTarget.currentTime = sourceTimeSec;
									if (play) {
										// See the other video.play() catch above: a rejection means
										// playback never started, so there's no state to reconcile.
										void e.currentTarget.play().catch(() => {
											// swallow: rejection just means playback never started
										});
									}
								} else if (clips.length > 0) {
									seekToVirtualTime(virtualTimeSec);
								}
							}}
							onWaiting={() => setLoadState("loading")}
							onCanPlay={() => setLoadState("ready")}
							onError={(e) => {
								// ponytail: don't blindly advance to the next source — if
								// the failed source owns the current virtual clip, the
								// next sourceIndex will seekToVirtualTime right back into
								// the same failed asset, looping. Fail the preview.
								pendingSeekRef.current = null;
								setLoadState("error");
								// An 'error' doesn't itself fire 'pause', so make sure the shell's
								// transport state (single source of truth, see NewEditorShell's
								// own play/pause/ended listener) actually learns playback stopped.
								e.currentTarget.pause();
								onVideoError?.(activeSource.id);
							}}
							onEnded={() => {
								// BUG corrigé : ce handler stoppait TOUJOURS la lecture dès que le
								// <video> brut atteignait SA PROPRE fin de fichier — une course
								// avec la boucle rAF (reachedClipEnd, plus haut) qui gère
								// l'enchaînement multi-clip. Pour un clip NON trimé, la fin réelle
								// du fichier coïncide avec la fin de sa fenêtre timeline, et
								// l'événement navigateur 'ended' gagnait quasi systématiquement
								// cette course (déclenché par le navigateur dès la dernière frame,
								// avant le prochain tick rAF) : la lecture s'arrêtait au lieu
								// d'enchaîner sur le clip suivant — le "ça s'arrête en fin de clip"
								// qui persistait malgré les fixes de la boucle rAF elle-même.
								// `forceResume` (voir seekToVirtualTime) est nécessaire ici : le
								// navigateur a déjà mis `.paused = true` avant de déclencher
								// 'ended', donc le check `!video.paused` habituel empêcherait
								// toujours la reprise de la lecture sur le clip suivant. Si aucun
								// clip suivant n'existe, on ne fait rien de plus ici : le navigateur
								// a déjà mis la vidéo en pause, et NewEditorShell (seule source de
								// vérité pour l'état de lecture) l'apprend via son propre listener
								// 'ended'/'pause' sur ce même élément.
								const current = clipsRef.current.find(
									(clip) => clip.id === activeClipIdRef.current,
								);
								const nextClip = current
									? findNextClipByTimelineOrder(clipsRef.current, current.timelineStartSec)
									: undefined;
								if (nextClip) {
									seekToVirtualTime(nextClip.timelineStartSec, true, true);
								}
							}}
							// The visual presentation loop above replaces onTimeUpdate and also
							// handles clip-end advancement.
						/>
						{!previewPolicy.useNativeCompositor && clockRef ? (
							<CursorDomOverlay
								videoPath={activeSource.sourcePath ?? null}
								clockRef={clockRef}
								visible={settings.cursorShow}
								themeId={settings.cursorTheme}
								size={settings.cursor.size}
							/>
						) : null}
						{/* Plus d'overlay « Loading preview… » : il reflétait l'état du <video>
						    CACHÉ (source horloge/audio), pas la preview RÉELLE — le canvas natif,
						    qui montre déjà une image valide pendant que le <video> re-seek. Il
						    recouvrait donc une bonne image à chaque scrub, pour rien. On garde
						    seulement l'erreur, qui, elle, signale un vrai échec de chargement. */}
						{loadState === "error" && (
							<div className={styles.overlay}>Video preview could not be loaded.</div>
						)}
					</div>
				</>
			) : (
				<div className={styles.placeholder}>Attach a video to start previewing.</div>
			)}
		</div>
	);
}
