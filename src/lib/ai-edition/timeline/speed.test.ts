import { describe, expect, it } from "vitest";
import {
	findActivePreparedSpeedRegion,
	findActiveSpeedRegion,
	prepareSpeedRegions,
	type SpeedRegion,
} from "./speed";

describe("prepared speed-region lookup", () => {
	const regions: SpeedRegion[] = [
		{ id: "late", startMs: 4_000, endMs: 8_000, speed: 2 },
		{ id: "early", startMs: 0, endMs: 5_000, speed: 1.5 },
		{ id: "nested", startMs: 4_500, endMs: 4_750, speed: 4 },
	];

	it("matches the legacy first-array-match semantics for unordered and overlapping regions", () => {
		const prepared = prepareSpeedRegions(regions);
		for (const timeMs of [-1, 0, 3_999, 4_000, 4_600, 4_999, 5_000, 7_999, 8_000]) {
			expect(findActivePreparedSpeedRegion(prepared, timeMs)).toBe(
				findActiveSpeedRegion(regions, timeMs),
			);
		}
	});

	it("uses half-open boundaries and ignores empty regions", () => {
		const prepared = prepareSpeedRegions([
			{ id: "empty", startMs: 2_000, endMs: 2_000, speed: 8 },
			{ id: "next", startMs: 2_000, endMs: 3_000, speed: 2 },
		]);

		expect(findActivePreparedSpeedRegion(prepared, 1_999)).toBeNull();
		expect(findActivePreparedSpeedRegion(prepared, 2_000)?.id).toBe("next");
		expect(findActivePreparedSpeedRegion(prepared, 3_000)).toBeNull();
	});
});
