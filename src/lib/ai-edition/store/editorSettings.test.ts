import { describe, expect, it } from "vitest";
import {
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_WEBCAM_LAYOUT_PRESET,
	DEFAULT_WEBCAM_MASK_SHAPE,
} from "@/components/video-editor/types";
import type { AxcutDocument } from "../schema";
import { axcutSchemaVersion } from "../schema";
import {
	CURSOR_ANIMATION_SMOOTHING,
	cursorAnimationStyleForSmoothing,
	DEFAULT_EDITOR_SETTINGS,
	getEditorSettings,
	patchEditorSettings,
} from "./editorSettings";

const baseDoc: AxcutDocument = {
	schemaVersion: axcutSchemaVersion,
	project: {
		id: "p1",
		title: "Test",
		createdAt: "2026-06-25T10:00:00.000Z",
		updatedAt: "2026-06-25T10:00:00.000Z",
		primaryAssetId: "a1",
	},
	assets: [{ id: "a1", kind: "video", label: "clip", originalPath: "/x.mp4", cameraTrack: null }],
	timeline: {
		clips: [],
		gaps: [],
		trimRanges: [],
		muteRanges: [],
		speedRanges: [],
		captionRanges: [],
	},
	annotations: [],
	zoomRanges: [],
	transcripts: [],
	transcript: null,
	legacyEditor: null,
};

describe("getEditorSettings", () => {
	it("returns the defaults when the document has no legacyEditor", () => {
		const snap = getEditorSettings(baseDoc);
		expect(snap.wallpaper).toBe(DEFAULT_EDITOR_SETTINGS.wallpaper);
		expect(snap.aspectRatio).toBe("native");
		expect(snap.borderRadius).toBe(0);
		expect(snap.padding).toBe(0);
		expect(snap.shadowIntensity).toBe(DEFAULT_EDITOR_SETTINGS.shadowIntensity);
		expect(snap.showBlur).toBe(false);
		expect(snap.motionBlurZoom).toBe(DEFAULT_EDITOR_SETTINGS.motionBlurZoom);
		expect(snap.motionBlurPan).toBe(DEFAULT_EDITOR_SETTINGS.motionBlurPan);
		expect(snap.webcamLayoutPreset).toBe(DEFAULT_WEBCAM_LAYOUT_PRESET);
		expect(snap.webcamMaskShape).toBe(DEFAULT_WEBCAM_MASK_SHAPE);
		expect(snap.cursor.size).toBe(DEFAULT_CURSOR_SIZE);
		expect(snap.screenAnimationStyle).toBe("focused");
	});

	it("returns the defaults when the document is null", () => {
		const snap = getEditorSettings(null);
		expect(snap).toEqual(DEFAULT_EDITOR_SETTINGS);
	});

	it("reads overrides from legacyEditor", () => {
		const doc: AxcutDocument = {
			...baseDoc,
			legacyEditor: {
				wallpaper: "linear-gradient(red, blue)",
				aspectRatio: "9:16",
				shadowIntensity: 0.5,
				showBlur: true,
				webcamLayoutPreset: "side-by-side",
				webcamMaskShape: "circle",
				cursorSize: 5,
				cursorSmoothing: 0.8,
				screenAnimationStyle: "smooth",
			},
		};
		const snap = getEditorSettings(doc);
		expect(snap.wallpaper).toBe("linear-gradient(red, blue)");
		expect(snap.aspectRatio).toBe("9:16");
		expect(snap.shadowIntensity).toBe(0.5);
		expect(snap.showBlur).toBe(true);
		expect(snap.webcamLayoutPreset).toBe("side-by-side");
		expect(snap.webcamMaskShape).toBe("circle");
		expect(snap.cursor.size).toBe(5);
		expect(snap.cursor.smoothing).toBe(0.8);
		expect(snap.screenAnimationStyle).toBe("smooth");
	});

	it("falls back to defaults for unknown or wrong-type values", () => {
		const doc: AxcutDocument = {
			...baseDoc,
			legacyEditor: { showBlur: "not-a-bool" as unknown as boolean },
		};
		const snap = getEditorSettings(doc);
		expect(snap.showBlur).toBe(false);
		expect(snap.screenAnimationStyle).toBe("focused");
	});

	it("uses the legacy screen blur for both motion channels in old projects", () => {
		const doc: AxcutDocument = {
			...baseDoc,
			legacyEditor: { motionBlurAmount: 0.63 },
		};
		const snap = getEditorSettings(doc);
		expect(snap.motionBlurAmount).toBe(0.63);
		expect(snap.motionBlurZoom).toBe(0.63);
		expect(snap.motionBlurPan).toBe(0.63);
	});

	it("reads independent screen motion blur channels when present", () => {
		const doc: AxcutDocument = {
			...baseDoc,
			legacyEditor: { motionBlurAmount: 0.4, motionBlurZoom: 0.8, motionBlurPan: 0.25 },
		};
		const snap = getEditorSettings(doc);
		expect(snap.motionBlurAmount).toBe(0.4);
		expect(snap.motionBlurZoom).toBe(0.8);
		expect(snap.motionBlurPan).toBe(0.25);
	});
});

describe("patchEditorSettings", () => {
	it("writes a single field and leaves others intact", () => {
		const next = patchEditorSettings(baseDoc, { showBlur: true });
		const snap = getEditorSettings(next);
		expect(snap.showBlur).toBe(true);
		expect(snap.shadowIntensity).toBe(DEFAULT_EDITOR_SETTINGS.shadowIntensity);
		expect(snap.cropRegion).toEqual(DEFAULT_CROP_REGION);
	});

	it("merges into an existing legacyEditor envelope", () => {
		const seed = patchEditorSettings(baseDoc, { showBlur: true });
		const next = patchEditorSettings(seed, { shadowIntensity: 0.7 });
		const snap = getEditorSettings(next);
		expect(snap.showBlur).toBe(true);
		expect(snap.shadowIntensity).toBe(0.7);
	});

	it("treats an explicitly undefined key as absent, not as a clear", () => {
		const seed = patchEditorSettings(baseDoc, { showBlur: true, shadowIntensity: 0.7 });
		const next = patchEditorSettings(seed, { showBlur: undefined, padding: 12 });
		const snap = getEditorSettings(next);
		expect(snap.showBlur).toBe(true);
		expect(snap.shadowIntensity).toBe(0.7);
		expect(snap.padding).toBe(12);
	});

	it("patches nested cursor settings without clobbering siblings", () => {
		const seed = patchEditorSettings(baseDoc, { cursor: { size: 4 } });
		const next = patchEditorSettings(seed, { cursor: { smoothing: 0.9 } });
		const snap = getEditorSettings(next);
		expect(snap.cursor.size).toBe(4);
		expect(snap.cursor.smoothing).toBe(0.9);
	});

	it("round-trips the screen animation style", () => {
		const styles = ["rapid", "focused", "balanced", "smooth", "cinematic", "classic"] as const;
		for (const style of styles) {
			const next = patchEditorSettings(baseDoc, { screenAnimationStyle: style });
			expect(getEditorSettings(next).screenAnimationStyle).toBe(style);
		}
	});

	it("falls back to focused for an unknown persisted screen animation style", () => {
		const doc: AxcutDocument = {
			...baseDoc,
			legacyEditor: { screenAnimationStyle: "elastic" },
		};
		expect(getEditorSettings(doc).screenAnimationStyle).toBe("focused");
	});

	it("round-trips independent screen motion blur channels", () => {
		const next = patchEditorSettings(baseDoc, { motionBlurZoom: 0.72, motionBlurPan: 0.31 });
		const snap = getEditorSettings(next);
		expect(snap.motionBlurZoom).toBe(0.72);
		expect(snap.motionBlurPan).toBe(0.31);
	});

	it("does not mutate the source document", () => {
		const before = getEditorSettings(baseDoc);
		patchEditorSettings(baseDoc, { showBlur: true });
		const after = getEditorSettings(baseDoc);
		expect(after).toEqual(before);
	});

	it("round-trips webcamPosition through legacyEditor", () => {
		const dragged = patchEditorSettings(baseDoc, {
			webcamPosition: { cx: 0.32, cy: 0.71 },
		});
		const snap = getEditorSettings(dragged);
		expect(snap.webcamPosition).toEqual({ cx: 0.32, cy: 0.71 });
	});

	it("clamps out-of-range webcamPosition when reading", () => {
		const doc: AxcutDocument = {
			...baseDoc,
			legacyEditor: { webcamPosition: { cx: 1.7, cy: -0.4 } },
		};
		const snap = getEditorSettings(doc);
		expect(snap.webcamPosition).toEqual({ cx: 1, cy: 0 });
	});
});

describe("cursor animation style presets", () => {
	it("map the four cards onto the existing smoothing setting", () => {
		expect(CURSOR_ANIMATION_SMOOTHING.none).toBe(0);
		expect(CURSOR_ANIMATION_SMOOTHING.rapid).toBeLessThan(CURSOR_ANIMATION_SMOOTHING.medium);
		expect(CURSOR_ANIMATION_SMOOTHING.medium).toBeLessThan(CURSOR_ANIMATION_SMOOTHING.smooth);
	});

	it("select the nearest card for legacy numeric values", () => {
		expect(cursorAnimationStyleForSmoothing(0)).toBe("none");
		expect(cursorAnimationStyleForSmoothing(0.2)).toBe("rapid");
		expect(cursorAnimationStyleForSmoothing(0.4)).toBe("medium");
		expect(cursorAnimationStyleForSmoothing(0.7)).toBe("smooth");
	});
});
