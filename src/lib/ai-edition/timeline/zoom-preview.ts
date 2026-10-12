// Live-preview zoom transform for the new editor's CSS-based preview stack.
//
// Reuses the legacy editor's region math (`findDominantRegion`,
// `computeZoomTransform`) so zoom-in/out easing, region priority, and focus
// resolution stay identical between the two editors — only the output
// differs: a CSS translate/scale pair instead of a Pixi container transform.
//
// `computeZoomTransform` is called with a unit stage ({width:1, height:1}),
// which makes its pixel-space output already a fraction of the preview
// box — exactly what CSS `translate(x%, y%)` expects (percentages resolve
// against the transformed element's own layout box).

import type {
	CursorTelemetryPoint,
	ZoomRegion as LegacyZoomRegion,
} from "@/components/video-editor/types";
import { getZoomScale } from "@/components/video-editor/types";
import type { AxcutZoomRegion } from "@/lib/ai-edition/schema";
import { SCREEN_ANIMATION_SPRINGS, type ScreenAnimationStyle } from "@/lib/zoomMath/constants";
import { findDominantRegion } from "@/lib/zoomMath/zoomRegionUtils";
import { computeZoomTransform } from "@/lib/zoomMath/zoomTransform";

export interface ZoomPreviewTransform {
	scale: number;
	translateXPercent: number;
	translateYPercent: number;
}

export const IDENTITY_ZOOM_TRANSFORM: ZoomPreviewTransform = {
	scale: 1,
	translateXPercent: 0,
	translateYPercent: 0,
};

const UNIT_STAGE = { width: 1, height: 1 };
const UNIT_MASK = { x: 0, y: 0, width: 1, height: 1 };

function toLegacyZoomRegion(region: AxcutZoomRegion): LegacyZoomRegion {
	return {
		id: region.id,
		startMs: region.startMs,
		endMs: region.endMs,
		depth: region.depth,
		focus: region.focus,
		focusMode: region.focusMode,
		rotationPreset: region.rotationPreset,
		customScale: region.customScale,
		source: region.source,
	};
}

interface IndexedZoomRegion {
	region: LegacyZoomRegion;
	originalIndex: number;
}

export interface PreparedZoomPreviewRegions {
	regions: LegacyZoomRegion[];
	byStart: IndexedZoomRegion[];
	startTimes: number[];
	maxEndTree: number[];
}

function buildMaxEndTree(entries: IndexedZoomRegion[]): number[] {
	const tree = new Array<number>(Math.max(1, entries.length * 4)).fill(-Infinity);
	const build = (node: number, left: number, right: number): number => {
		if (right - left === 1) {
			tree[node] = entries[left].region.endMs;
			return tree[node];
		}
		const middle = (left + right) >>> 1;
		tree[node] = Math.max(build(node * 2, left, middle), build(node * 2 + 1, middle, right));
		return tree[node];
	};
	if (entries.length > 0) build(1, 0, entries.length);
	return tree;
}

/** Convert schema regions once when the document changes, not on every visual frame. */
export function prepareZoomPreviewRegions(
	zoomRegions: AxcutZoomRegion[],
): PreparedZoomPreviewRegions {
	const regions = zoomRegions.map(toLegacyZoomRegion);
	const byStart = regions
		.map((region, originalIndex) => ({ region, originalIndex }))
		.sort(
			(left, right) =>
				left.region.startMs - right.region.startMs || left.originalIndex - right.originalIndex,
		);
	return {
		regions,
		byStart,
		startTimes: byStart.map(({ region }) => region.startMs),
		maxEndTree: buildMaxEndTree(byStart),
	};
}

function upperBound(values: readonly number[], target: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

function findZoomCandidates(
	prepared: PreparedZoomPreviewRegions,
	timeMs: number,
	playbackRate: number,
	screenAnimationStyle: ScreenAnimationStyle,
): LegacyZoomRegion[] {
	const upperIndex = upperBound(prepared.startTimes, timeMs);
	if (upperIndex === 0) return [];
	const leadOutMs = SCREEN_ANIMATION_SPRINGS[screenAnimationStyle].durationMs * playbackRate;
	const minimumEndMs = timeMs - leadOutMs;
	const matches: IndexedZoomRegion[] = [];
	const visit = (node: number, left: number, right: number) => {
		if (left >= upperIndex || prepared.maxEndTree[node] <= minimumEndMs) return;
		if (right - left === 1) {
			matches.push(prepared.byStart[left]);
			return;
		}
		const middle = (left + right) >>> 1;
		visit(node * 2, left, middle);
		visit(node * 2 + 1, middle, right);
	};
	visit(1, 0, prepared.byStart.length);
	return matches
		.sort((left, right) => left.originalIndex - right.originalIndex)
		.map(({ region }) => region);
}

export function computePreparedZoomPreviewTransform(
	preparedRegions: PreparedZoomPreviewRegions,
	virtualTimeMs: number,
	cursorTelemetry?: CursorTelemetryPoint[],
	playbackRate = 1,
	screenAnimationStyle: ScreenAnimationStyle = "focused",
): ZoomPreviewTransform {
	if (preparedRegions.regions.length === 0) return IDENTITY_ZOOM_TRANSFORM;
	const candidates = findZoomCandidates(
		preparedRegions,
		virtualTimeMs,
		playbackRate,
		screenAnimationStyle,
	);
	if (candidates.length === 0) return IDENTITY_ZOOM_TRANSFORM;
	const dominant = findDominantRegion(candidates, virtualTimeMs, {
		cursorTelemetry,
		playbackRate,
		screenAnimationStyle,
	});
	if (!dominant.region || dominant.strength <= 0) return IDENTITY_ZOOM_TRANSFORM;

	const zoomScale = dominant.blendedScale ?? getZoomScale(dominant.region);
	const transform = computeZoomTransform({
		stageSize: UNIT_STAGE,
		baseMask: UNIT_MASK,
		zoomScale,
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

/**
 * Resolves the zoom transform to apply to the preview at a given point on
 * the virtual (edited) timeline. `virtualTimeMs` must be in the same
 * coordinate space as `zoomRegion.startMs`/`endMs` (the timeline shown in
 * the ruler, not raw source-media time).
 *
 * `playbackRate` scales the zoom-in/out transition windows in source-time
 * so the transition keeps its authored wall-clock duration inside speed
 * regions. Defaults to 1 (no scaling).
 */
export function computeZoomPreviewTransform(
	zoomRegions: AxcutZoomRegion[],
	virtualTimeMs: number,
	cursorTelemetry?: CursorTelemetryPoint[],
	playbackRate = 1,
	screenAnimationStyle: ScreenAnimationStyle = "focused",
): ZoomPreviewTransform {
	return computePreparedZoomPreviewTransform(
		prepareZoomPreviewRegions(zoomRegions),
		virtualTimeMs,
		cursorTelemetry,
		playbackRate,
		screenAnimationStyle,
	);
}
