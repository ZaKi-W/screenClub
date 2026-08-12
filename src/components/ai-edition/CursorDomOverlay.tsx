import { useEffect, useMemo, useRef } from "react";
import type { PlaybackClockRef } from "@/lib/ai-edition/timeline/playback-clock";
import getAssetPath from "@/lib/assetPath";
import { resolveCursorSprites } from "@/lib/cursor/cursorThemes";
import type {
	CursorRecordingSample,
	NativeCursorAsset,
	NativeCursorType,
} from "@/native/contracts";
import { useCursorRecordingData } from "@/native/hooks/useCursorRecordingData";

function assetUrl(path: string): string {
	try {
		return getAssetPath(path);
	} catch {
		return `/${path.replace(/^\/+/, "")}`;
	}
}

function surroundingSamples(
	samples: readonly CursorRecordingSample[],
	timeMs: number,
): [CursorRecordingSample | null, CursorRecordingSample | null] {
	if (samples.length === 0) return [null, null];
	let low = 0;
	let high = samples.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (samples[middle].timeMs <= timeMs) low = middle + 1;
		else high = middle - 1;
	}
	const before = samples[Math.max(0, high)] ?? null;
	const after = samples[Math.min(samples.length - 1, low)] ?? before;
	return [before, after];
}

interface CursorDomOverlayProps {
	videoPath: string | null;
	clockRef: PlaybackClockRef;
	visible: boolean;
	themeId: string;
	size: number;
}

/**
 * Lightweight cursor for Performance/Power Saving preview. It is driven by the
 * master video's delivered-frame clock and mutates one DOM node directly, so it
 * adds no React render or Electron frame transfer to the playback loop.
 */
export function CursorDomOverlay({
	videoPath,
	clockRef,
	visible,
	themeId,
	size,
}: CursorDomOverlayProps) {
	const imageRef = useRef<HTMLImageElement>(null);
	const lastSrcRef = useRef("");
	const { data } = useCursorRecordingData(videoPath);
	const nativeAssets = useMemo(
		() => new Map((data?.assets ?? []).map((asset) => [asset.id, asset])),
		[data?.assets],
	);
	const sprites = useMemo(() => resolveCursorSprites(themeId), [themeId]);
	const spriteUrls = useMemo(
		() =>
			new Map(
				Object.values(sprites).map((sprite) => [sprite.assetPath, assetUrl(sprite.assetPath)]),
			),
		[sprites],
	);

	useEffect(() => {
		const image = imageRef.current;
		if (!image) return;
		const paint = () => {
			const samples = data?.samples ?? [];
			if (!visible || samples.length === 0) {
				image.style.display = "none";
				return;
			}
			const timeMs = clockRef.current.sourceTimeSec * 1000;
			const [before, after] = surroundingSamples(samples, timeMs);
			if (!before || before.visible === false) {
				image.style.display = "none";
				return;
			}
			const span = Math.max(1, (after?.timeMs ?? before.timeMs) - before.timeMs);
			const progress = Math.max(0, Math.min(1, (timeMs - before.timeMs) / span));
			const cx = before.cx + ((after?.cx ?? before.cx) - before.cx) * progress;
			const cy = before.cy + ((after?.cy ?? before.cy) - before.cy) * progress;

			const nativeAsset: NativeCursorAsset | undefined = before.assetId
				? nativeAssets.get(before.assetId)
				: undefined;
			const cursorType: NativeCursorType = before.cursorType ?? "arrow";
			const sprite = sprites[cursorType] ?? sprites.arrow;
			const src = nativeAsset?.imageDataUrl || spriteUrls.get(sprite.assetPath) || "";
			if (src !== lastSrcRef.current) {
				image.src = src;
				lastSrcRef.current = src;
			}
			const logicalWidth = nativeAsset
				? nativeAsset.width / Math.max(1, nativeAsset.scaleFactor ?? 1)
				: 32;
			const logicalHeight = nativeAsset
				? nativeAsset.height / Math.max(1, nativeAsset.scaleFactor ?? 1)
				: 32;
			const hotspotX = nativeAsset
				? nativeAsset.hotspotX / Math.max(1, nativeAsset.width)
				: sprite.hotspotX;
			const hotspotY = nativeAsset
				? nativeAsset.hotspotY / Math.max(1, nativeAsset.height)
				: sprite.hotspotY;
			image.style.display = "block";
			image.style.left = `${cx * 100}%`;
			image.style.top = `${cy * 100}%`;
			image.style.width = `${Math.max(8, logicalWidth * size)}px`;
			image.style.height = `${Math.max(8, logicalHeight * size)}px`;
			image.style.transform = `translate(${-hotspotX * 100}%, ${-hotspotY * 100}%)`;
		};
		paint();
		return clockRef.subscribe(paint);
	}, [clockRef, data?.samples, nativeAssets, size, spriteUrls, sprites, visible]);

	return (
		<img
			ref={imageRef}
			alt=""
			aria-hidden
			style={{
				position: "absolute",
				zIndex: 4,
				pointerEvents: "none",
				objectFit: "contain",
				willChange: "left, top, transform",
				display: "none",
			}}
		/>
	);
}
