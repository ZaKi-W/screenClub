/**
 * Mirrors the app's transport (play/pause) and playhead (scrub/step) onto the
 * active native compositor view. Mounted once in the editor shell; a no-op
 * whenever no native view is active (flag off / addon absent), so it's safe to
 * call unconditionally.
 *
 * Playback model — why we don't push a seek every frame:
 *  - Play/pause maps to native *free-run* (`setNativePlaying`). While playing,
 *    the native decoder advances its own frames sequentially (cheap).
 *  - `currentTimeSec` ticks every rAF frame during playback. Pushing
 *    `setNativeTime` per tick would force an O(n) rewind+decode seek each frame
 *    AND fight the free-run (the render thread prioritises app-requested frames
 *    over free-run). So discrete seeks are only sent while *paused* — i.e. real
 *    scrub/step interactions. Pausing also re-snaps native to the app playhead.
 *
 * Known POC limitation: during free-run the native clock and the app clock can
 * drift (independent tickers); acceptable for the fixture (~6 s loop). A pause
 * re-aligns them.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AxcutClip } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import type { SpeedRegion } from "@/lib/ai-edition/timeline/speed";
import { resolveNativePosition } from "@/lib/ai-edition/timeline/timelineMap";
import {
	getCurrentNativeViewId,
	setNativePlaying,
	setNativeTime,
	subscribeNativeCompositor,
} from "./nativeCompositorStore";

const NATIVE_RESYNC_TOLERANCE_SEC = 0.1;
const MAX_PREVIEW_PLAYBACK_RATE = 16;
const TIME_EPSILON_SEC = 1e-9;

interface PlaybackSyncAnchor {
	timelineTimeSec: number;
	sourceTimeSec: number;
	wallTimeMs: number;
}

function playbackRateAt(regions: readonly SpeedRegion[], timelineTimeSec: number): number {
	const active = regions.find(
		(region) => timelineTimeSec * 1000 >= region.startMs && timelineTimeSec * 1000 < region.endMs,
	);
	if (!active || !Number.isFinite(active.speed) || active.speed <= 0) return 1;
	// VirtualPreview applies the browser's live-preview ceiling before writing
	// video.playbackRate. This hook follows that same master clock; rates above
	// the ceiling remain an offline-export feature.
	return Math.min(active.speed, MAX_PREVIEW_PLAYBACK_RATE);
}

/**
 * Advance the preview's RAW timeline clock through speed-region boundaries.
 *
 * Speed regions do not resize the ruler: they change how quickly the screen
 * video's source clock traverses it. Integrating in timeline space keeps the
 * comparison in the same clock domain as VirtualPreview, while the caller can
 * apply the resulting delta to an active clip's source-time anchor.
 */
export function advanceTimelineByWallTime(
	startTimelineSec: number,
	wallElapsedSec: number,
	regions: readonly SpeedRegion[],
): number {
	if (!Number.isFinite(startTimelineSec) || !Number.isFinite(wallElapsedSec)) {
		return startTimelineSec;
	}
	let timelineSec = startTimelineSec;
	let remainingWallSec = Math.max(0, wallElapsedSec);

	// Every iteration consumes either all remaining wall time or crosses one
	// region boundary. The guard only protects malformed/extreme documents; in
	// normal projects the loop runs once or twice per sync check.
	for (
		let boundaryCount = 0;
		remainingWallSec > TIME_EPSILON_SEC && boundaryCount < 10_000;
		boundaryCount += 1
	) {
		const rate = playbackRateAt(regions, timelineSec);
		let nextBoundarySec = Number.POSITIVE_INFINITY;
		for (const region of regions) {
			const startSec = region.startMs / 1000;
			const endSec = region.endMs / 1000;
			if (startSec > timelineSec + TIME_EPSILON_SEC) {
				nextBoundarySec = Math.min(nextBoundarySec, startSec);
			}
			if (endSec > timelineSec + TIME_EPSILON_SEC) {
				nextBoundarySec = Math.min(nextBoundarySec, endSec);
			}
		}

		const timelineAdvance = remainingWallSec * rate;
		if (!Number.isFinite(nextBoundarySec) || timelineSec + timelineAdvance <= nextBoundarySec) {
			timelineSec += timelineAdvance;
			remainingWallSec = 0;
			break;
		}

		const distanceToBoundarySec = nextBoundarySec - timelineSec;
		timelineSec = nextBoundarySec;
		remainingWallSec -= distanceToBoundarySec / rate;
	}

	return timelineSec;
}

export function nativePlaybackDriftSec(
	currentSourceTimeSec: number,
	nowWallTimeMs: number,
	anchor: PlaybackSyncAnchor,
	regions: readonly SpeedRegion[],
): number {
	const elapsedWallSec = Math.max(0, (nowWallTimeMs - anchor.wallTimeMs) / 1000);
	const expectedTimelineTimeSec = advanceTimelineByWallTime(
		anchor.timelineTimeSec,
		elapsedWallSec,
		regions,
	);
	const expectedSourceTimeSec =
		anchor.sourceTimeSec + (expectedTimelineTimeSec - anchor.timelineTimeSec);
	return currentSourceTimeSec - expectedSourceTimeSec;
}

export function useNativePlaybackSync(
	playing: boolean,
	currentTimeSec: number,
	/** Trim-compressed playback segments (`resolveVisibleClips`) — the native stream. */
	visibleSegments: readonly AxcutClip[],
	/** RAW clip layout (`document.timeline.clips`) `currentTimeSec` is expressed against. */
	rawClips: readonly AxcutClip[],
	enabled = true,
): void {
	const document = useProjectStore((state) => state.document);
	const speedRegions = useMemo(
		() =>
			((document?.legacyEditor as Record<string, unknown> | null)?.speedRegions as
				| SpeedRegion[]
				| undefined) ?? [],
		[document],
	);
	const activePosition = useMemo(
		() => resolveNativePosition(currentTimeSec, [...visibleSegments], [...rawClips]),
		[visibleSegments, rawClips, currentTimeSec],
	);
	const activeClipId = activePosition?.clip.id ?? null;
	const sourceTimeSec = activePosition?.sourceTimeSec ?? null;

	// Reactive "is a native view active?" so activation mid-session re-pushes the
	// current transport/playhead (time & playing aren't memoised in the store).
	const active = useSyncExternalStore(
		subscribeNativeCompositor,
		() => getCurrentNativeViewId() !== null,
	);

	// Play/pause → native free-run.
	useEffect(() => {
		if (!active || !enabled) {
			return;
		}
		setNativePlaying(playing);
	}, [active, enabled, playing]);

	// Scrub/step while paused OR periodic resync during playback when drift > 100ms
	const lastSyncedSourceTimeRef = useRef<number | null>(null);
	const lastSyncedTimelineTimeRef = useRef<number | null>(null);
	const lastSyncedWallTimeRef = useRef<number>(0);
	const lastActiveClipIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!active || !enabled || sourceTimeSec === null || !activeClipId) {
			return;
		}
		const now = performance.now();

		// When clip changes, let setActiveClip handle the atomic clip-switch-and-seek.
		if (lastActiveClipIdRef.current !== activeClipId) {
			lastActiveClipIdRef.current = activeClipId;
			lastSyncedSourceTimeRef.current = sourceTimeSec;
			lastSyncedTimelineTimeRef.current = currentTimeSec;
			lastSyncedWallTimeRef.current = now;
			return;
		}

		if (!playing) {
			setNativeTime(sourceTimeSec);
			lastSyncedSourceTimeRef.current = sourceTimeSec;
			lastSyncedTimelineTimeRef.current = currentTimeSec;
			lastSyncedWallTimeRef.current = now;
			return;
		}
		// While playing: periodically verify master clock alignment to prevent drift
		if (
			lastSyncedSourceTimeRef.current === null ||
			lastSyncedTimelineTimeRef.current === null ||
			lastSyncedWallTimeRef.current === 0
		) {
			lastSyncedSourceTimeRef.current = sourceTimeSec;
			lastSyncedTimelineTimeRef.current = currentTimeSec;
			lastSyncedWallTimeRef.current = now;
			return;
		}
		const driftSec = nativePlaybackDriftSec(
			sourceTimeSec,
			now,
			{
				timelineTimeSec: lastSyncedTimelineTimeRef.current,
				sourceTimeSec: lastSyncedSourceTimeRef.current,
				wallTimeMs: lastSyncedWallTimeRef.current,
			},
			speedRegions,
		);
		if (Math.abs(driftSec) > NATIVE_RESYNC_TOLERANCE_SEC) {
			setNativeTime(sourceTimeSec);
			lastSyncedSourceTimeRef.current = sourceTimeSec;
			lastSyncedTimelineTimeRef.current = currentTimeSec;
			lastSyncedWallTimeRef.current = now;
		}
	}, [active, enabled, playing, activeClipId, sourceTimeSec, currentTimeSec, speedRegions]);
}
