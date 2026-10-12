import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "@/components/video-editor/types";
import { getZoomScale } from "@/components/video-editor/types";
import type { AxcutZoomRegion } from "@/lib/ai-edition/schema";
import type { ScreenAnimationStyle } from "@/lib/zoomMath/constants";
import { findDominantRegion } from "@/lib/zoomMath/zoomRegionUtils";
import { computeZoomTransform } from "@/lib/zoomMath/zoomTransform";
import {
	computePreparedZoomPreviewTransform,
	IDENTITY_ZOOM_TRANSFORM,
	prepareZoomPreviewRegions,
} from "./zoom-preview";

const regions: AxcutZoomRegion[] = [
	{
		id: "late",
		startMs: 3_000,
		endMs: 5_000,
		depth: 2,
		customScale: 2,
		focus: { cx: 0.7, cy: 0.4 },
		source: "manual",
	},
	{
		id: "early",
		startMs: 0,
		endMs: 4_000,
		depth: 1,
		customScale: 1.5,
		focus: { cx: 0.2, cy: 0.8 },
		source: "manual",
	},
];

function reference(timeMs: number, playbackRate: number, style: ScreenAnimationStyle) {
	const legacy = regions as ZoomRegion[];
	const dominant = findDominantRegion(legacy, timeMs, {
		playbackRate,
		screenAnimationStyle: style,
	});
	if (!dominant.region || dominant.strength <= 0) return IDENTITY_ZOOM_TRANSFORM;
	const scale = dominant.blendedScale ?? getZoomScale(dominant.region);
	const transform = computeZoomTransform({
		stageSize: { width: 1, height: 1 },
		baseMask: { x: 0, y: 0, width: 1, height: 1 },
		zoomScale: scale,
		zoomProgress: dominant.strength,
		focusX: dominant.region.focus.cx,
		focusY: dominant.region.focus.cy,
	});
	return {
		scale: transform.scale,
		translateXPercent: transform.x * 100,
		translateYPercent: transform.y * 100,
	};
}

describe("prepared zoom-preview lookup", () => {
	it.each([
		["focused", 1],
		["smooth", 2],
	] as const)("keeps the full-scan result for %s at %sx", (style, playbackRate) => {
		const prepared = prepareZoomPreviewRegions(regions);
		for (const timeMs of [-1, 0, 200, 1_000, 3_000, 3_500, 4_100, 5_000, 5_500, 6_500]) {
			expect(
				computePreparedZoomPreviewTransform(prepared, timeMs, undefined, playbackRate, style),
			).toEqual(reference(timeMs, playbackRate, style));
		}
	});
});
