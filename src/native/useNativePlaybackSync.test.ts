import { describe, expect, it } from "vitest";
import type { SpeedRegion } from "@/lib/ai-edition/timeline/speed";
import { advanceTimelineByWallTime, nativePlaybackDriftSec } from "./useNativePlaybackSync";

function speedRegion(startSec: number, endSec: number, speed: number, id = "speed"): SpeedRegion {
	return { id, startMs: startSec * 1000, endMs: endSec * 1000, speed };
}

describe("advanceTimelineByWallTime", () => {
	it("advances at the active speed instead of assuming 1x", () => {
		expect(advanceTimelineByWallTime(2, 0.5, [speedRegion(1, 4, 2)])).toBeCloseTo(3, 8);
	});

	it("integrates across the end of a speed region", () => {
		// 2.75 -> 3.0 consumes 125 ms at 2x; the remaining 375 ms runs at 1x.
		expect(advanceTimelineByWallTime(2.75, 0.5, [speedRegion(1, 3, 2)])).toBeCloseTo(3.375, 8);
	});

	it("integrates across the start of a speed region", () => {
		// 1.75 -> 2.0 consumes 250 ms at 1x; the remaining 250 ms advances 500 ms at 2x.
		expect(advanceTimelineByWallTime(1.75, 0.5, [speedRegion(2, 4, 2)])).toBeCloseTo(2.5, 8);
	});

	it("keeps first-match overlap semantics", () => {
		const regions = [speedRegion(1, 4, 2, "first"), speedRegion(2, 5, 4, "second")];
		expect(advanceTimelineByWallTime(2, 0.25, regions)).toBeCloseTo(2.5, 8);
	});

	it("uses the same 16x ceiling as the live browser preview", () => {
		expect(advanceTimelineByWallTime(2, 0.1, [speedRegion(1, 4, 32)])).toBeCloseTo(3.6, 8);
	});
});

describe("nativePlaybackDriftSec", () => {
	it("does not report correctly progressing 2x playback as drift", () => {
		const drift = nativePlaybackDriftSec(
			13,
			1_500,
			{ timelineTimeSec: 2, sourceTimeSec: 12, wallTimeMs: 1_000 },
			[speedRegion(1, 4, 2)],
		);
		expect(drift).toBeCloseTo(0, 8);
	});

	it("still reports real master-clock drift", () => {
		const drift = nativePlaybackDriftSec(
			13.25,
			1_500,
			{ timelineTimeSec: 2, sourceTimeSec: 12, wallTimeMs: 1_000 },
			[speedRegion(1, 4, 2)],
		);
		expect(drift).toBeCloseTo(0.25, 8);
	});

	it("keeps source offsets while integrating in timeline space", () => {
		const drift = nativePlaybackDriftSec(
			21,
			1_500,
			{ timelineTimeSec: 2, sourceTimeSec: 20, wallTimeMs: 1_000 },
			[speedRegion(1, 4, 2)],
		);
		expect(drift).toBeCloseTo(0, 8);
	});
});
