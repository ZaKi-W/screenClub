import { describe, expect, it } from "vitest";
import { findActiveIntervalSpan, prepareActiveIntervalSpans } from "./active-interval-index";

describe("prepareActiveIntervalSpans", () => {
	it("returns every active input index with half-open boundary semantics", () => {
		const prepared = prepareActiveIntervalSpans([
			{ start: 1000, end: 4000 },
			{ start: 2000, end: 3000 },
			{ start: 3000, end: 5000 },
		]);

		expect(findActiveIntervalSpan(prepared, 999)).toBeUndefined();
		expect(findActiveIntervalSpan(prepared, 1000)?.itemIndexes).toEqual([0]);
		expect(findActiveIntervalSpan(prepared, 2500)?.itemIndexes).toEqual([0, 1]);
		expect(findActiveIntervalSpan(prepared, 3000)?.itemIndexes).toEqual([0, 2]);
		expect(findActiveIntervalSpan(prepared, 4000)?.itemIndexes).toEqual([2]);
		expect(findActiveIntervalSpan(prepared, 5000)).toBeUndefined();
	});

	it("ignores empty/reversed intervals and merges adjacent spans with equal membership", () => {
		const prepared = prepareActiveIntervalSpans([
			{ start: 0, end: 10 },
			{ start: 5, end: 5 },
			{ start: 8, end: 2 },
		]);
		expect(prepared.spans).toEqual([{ start: 0, end: 10, itemIndexes: [0] }]);
	});
});
