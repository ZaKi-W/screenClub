import { describe, expect, it } from "vitest";
import {
	isScreenRecordingPermissionError,
	parseMacDisplayIdFromSourceId,
	parseMacWindowIdFromSourceId,
	SCREEN_PERMISSION_DENIED_CODE,
} from "./nativeMacRecording";

describe("nativeMacRecording source parsing", () => {
	it("parses Electron window source ids into ScreenCaptureKit window ids", () => {
		expect(parseMacWindowIdFromSourceId("window:12345:0")).toBe(12345);
		expect(parseMacWindowIdFromSourceId("window:987")).toBe(987);
	});

	it("rejects non-window source ids for window parsing", () => {
		expect(parseMacWindowIdFromSourceId("screen:1:0")).toBeNull();
		expect(parseMacWindowIdFromSourceId("window:not-a-number:0")).toBeNull();
		expect(parseMacWindowIdFromSourceId(null)).toBeNull();
	});

	it("parses Electron display source ids into ScreenCaptureKit display ids", () => {
		expect(parseMacDisplayIdFromSourceId("screen:1:0")).toBe(1);
		expect(parseMacDisplayIdFromSourceId("screen:69733248")).toBe(69733248);
	});

	it("rejects non-display source ids for display parsing", () => {
		expect(parseMacDisplayIdFromSourceId("window:123:0")).toBeNull();
		expect(parseMacDisplayIdFromSourceId("screen:not-a-number:0")).toBeNull();
		expect(parseMacDisplayIdFromSourceId(undefined)).toBeNull();
	});
});

describe("nativeMacRecording permission errors", () => {
	it("recognizes the structured ScreenCaptureKit permission code", () => {
		expect(isScreenRecordingPermissionError({ code: SCREEN_PERMISSION_DENIED_CODE })).toBe(true);
		expect(
			isScreenRecordingPermissionError(new Error("Screen recording permission is required")),
		).toBe(false);
		expect(isScreenRecordingPermissionError(null)).toBe(false);
	});
});
