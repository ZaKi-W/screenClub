import { describe, expect, it } from "vitest";
import type { AxcutAnnotationRegion } from "../schema";
import {
	findAnnotationVisibilitySpan,
	prepareAnnotationVisibility,
	resolveVisibleAnnotations,
} from "./annotation-visibility";

function annotation(id: string, startMs: number, endMs: number, zIndex: number) {
	return { id, startMs, endMs, zIndex } as AxcutAnnotationRegion;
}

describe("annotation visibility index", () => {
	const annotations = [
		annotation("back", 1000, 4000, 1),
		annotation("front", 2000, 3000, 9),
		annotation("later", 4000, 5000, 2),
	];
	const prepared = prepareAnnotationVisibility(annotations);

	it("uses stable half-open visibility spans", () => {
		expect(findAnnotationVisibilitySpan(prepared, 999)).toBeUndefined();
		expect(resolveVisibleAnnotations(prepared, 1000, null).map((item) => item.id)).toEqual([
			"back",
		]);
		expect(resolveVisibleAnnotations(prepared, 2500, null).map((item) => item.id)).toEqual([
			"back",
			"front",
		]);
		expect(resolveVisibleAnnotations(prepared, 4000, null).map((item) => item.id)).toEqual([
			"later",
		]);
		expect(resolveVisibleAnnotations(prepared, 5000, null)).toEqual([]);
	});

	it("keeps an inactive selection mounted and sorts the result by z-index", () => {
		expect(resolveVisibleAnnotations(prepared, 4500, "front").map((item) => item.id)).toEqual([
			"later",
			"front",
		]);
	});
});
