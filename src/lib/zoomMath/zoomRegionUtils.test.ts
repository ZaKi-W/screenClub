import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "@/components/video-editor/types";
import {
	SCREEN_ANIMATION_SPRINGS,
	SMOOTH_ZOOM_TRANSITION_WINDOW_MS,
	ZOOM_TRANSITION_WINDOW_MS,
} from "./constants";
import { computeRegionStrength } from "./zoomRegionUtils";

function region(startMs: number, endMs: number): ZoomRegion {
	return {
		id: "zoom-1",
		startMs,
		endMs,
		depth: 3,
		focus: { cx: 0.5, cy: 0.5 },
	};
}

describe("computeRegionStrength", () => {
	it("starts zooming at the region start and reaches full strength after 450 ms", () => {
		const zoom = region(3000, 4000);

		expect(computeRegionStrength(zoom, 2999)).toBe(0);
		expect(computeRegionStrength(zoom, 3000)).toBe(0);
		expect(computeRegionStrength(zoom, 3200)).toBeGreaterThan(0);
		expect(computeRegionStrength(zoom, 3450)).toBe(1);
		expect(computeRegionStrength(zoom, 3999)).toBe(1);
	});

	it("launches with near-zero velocity instead of front-loading the first frame", () => {
		const zoom = region(3000, 4000);

		expect(computeRegionStrength(zoom, 3001)).toBeLessThan(0.001);
		expect(computeRegionStrength(zoom, 3050)).toBeGreaterThan(0.1);
		expect(computeRegionStrength(zoom, 3050)).toBeLessThan(0.3);
	});

	it("uses the same 450 ms window for the zoom-out starting at the region end", () => {
		const zoom = region(3000, 5000);

		expect(computeRegionStrength(zoom, 5000)).toBe(1);
		expect(computeRegionStrength(zoom, 5200)).toBeLessThan(1);
		expect(computeRegionStrength(zoom, 5000 + ZOOM_TRANSITION_WINDOW_MS)).toBe(0);
	});

	it("reverses smoothly at the end of a region shorter than the zoom-in window", () => {
		const zoom = region(3000, 3250);
		const strengthAtEnd = computeRegionStrength(zoom, 3250);

		expect(strengthAtEnd).toBeGreaterThan(0);
		expect(strengthAtEnd).toBeLessThan(1);
		expect(computeRegionStrength(zoom, 3251)).toBeLessThan(strengthAtEnd);
		expect(computeRegionStrength(zoom, 3250 + ZOOM_TRANSITION_WINDOW_MS)).toBe(0);
	});

	it("uses a longer symmetric transition for the Smooth preset", () => {
		const zoom = region(3000, 5000);

		expect(computeRegionStrength(zoom, 3450, 1, "focused")).toBe(1);
		expect(computeRegionStrength(zoom, 3450, 1, "smooth")).toBeLessThan(1);
		expect(computeRegionStrength(zoom, 3000 + SMOOTH_ZOOM_TRANSITION_WINDOW_MS, 1, "smooth")).toBe(
			1,
		);
		expect(computeRegionStrength(zoom, 5000 + SMOOTH_ZOOM_TRANSITION_WINDOW_MS, 1, "smooth")).toBe(
			0,
		);
	});

	it("offers six materially different curves while keeping every authored edge exact", () => {
		const zoom = region(3000, 5000);
		const styles = ["rapid", "focused", "balanced", "smooth", "cinematic", "classic"] as const;
		const at50ms = styles.map((style) => computeRegionStrength(zoom, 3050, 1, style));

		expect(at50ms[0]).toBeGreaterThan(at50ms[1]);
		expect(at50ms[1]).toBeGreaterThan(at50ms[2]);
		expect(at50ms[2]).toBeGreaterThan(at50ms[3]);
		expect(at50ms[3]).toBeGreaterThan(at50ms[4]);
		expect(at50ms[5]).toBeGreaterThan(at50ms[0]);

		for (const style of styles) {
			const duration = SCREEN_ANIMATION_SPRINGS[style].durationMs;
			expect(computeRegionStrength(zoom, 3000 + duration, 1, style)).toBe(1);
			expect(computeRegionStrength(zoom, 5000 + duration, 1, style)).toBe(0);
		}
	});
});
