import { describe, expect, it } from "vitest";
import { decodeBgraFrame, isNativeCameraPreviewFrame } from "./cameraOverlay";

describe("camera overlay native frames", () => {
	it("validates and converts BGRA pixels to opaque RGBA", () => {
		const bgraBase64 = btoa(String.fromCharCode(30, 20, 10, 7));
		const frame = { width: 1, height: 1, bgraBase64 };

		expect(isNativeCameraPreviewFrame(frame)).toBe(true);
		expect(Array.from(decodeBgraFrame(frame) ?? [])).toEqual([10, 20, 30, 255]);
	});

	it("rejects malformed or incorrectly sized frames", () => {
		expect(isNativeCameraPreviewFrame({ width: 0, height: 1, bgraBase64: "" })).toBe(false);
		expect(decodeBgraFrame({ width: 2, height: 1, bgraBase64: btoa("short") })).toBeNull();
	});
});
