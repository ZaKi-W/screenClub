import type { ZoomFocus } from "@/components/video-editor/types";

export const DEFAULT_FOCUS: ZoomFocus = { cx: 0.5, cy: 0.5 };
export const TRANSITION_WINDOW_MS = 1015.05;
/** Screen Studio-style zoom ramp: start at the region edge and finish in about 0.45 s. */
export const ZOOM_TRANSITION_WINDOW_MS = 450;
/** The Smooth preset settles more gradually while preserving the authored region edges. */
export const SMOOTH_ZOOM_TRANSITION_WINDOW_MS = 650;
export type ScreenAnimationStyle =
	| "rapid"
	| "focused"
	| "balanced"
	| "smooth"
	| "cinematic"
	| "classic";

export type ScreenAnimationCurve = "spring" | "smootherstep" | "classic-bezier";

/**
 * Camera-response comparison presets. Screen Studio does not publish its exact values, but its
 * official changelog confirms a mass-based spring simulation. Most options are critically
 * damped; Cinematic adds a symmetric polynomial curve and Classic preserves the old Bezier so
 * the user can compare fundamentally different response shapes, not just durations.
 */
export const SCREEN_ANIMATION_SPRINGS: Record<
	ScreenAnimationStyle,
	{
		durationMs: number;
		stiffness: number;
		damping: number;
		mass: number;
		curve: ScreenAnimationCurve;
	}
> = {
	rapid: {
		durationMs: 320,
		stiffness: 625,
		damping: 50,
		mass: 1,
		curve: "spring",
	},
	focused: {
		durationMs: ZOOM_TRANSITION_WINDOW_MS,
		stiffness: 225,
		damping: 30,
		mass: 1,
		curve: "spring",
	},
	balanced: {
		durationMs: 540,
		stiffness: 121,
		damping: 22,
		mass: 1,
		curve: "spring",
	},
	smooth: {
		durationMs: SMOOTH_ZOOM_TRANSITION_WINDOW_MS,
		stiffness: 64,
		damping: 16,
		mass: 1,
		curve: "spring",
	},
	cinematic: {
		durationMs: 700,
		stiffness: 49,
		damping: 14,
		mass: 1,
		curve: "smootherstep",
	},
	classic: {
		durationMs: ZOOM_TRANSITION_WINDOW_MS,
		stiffness: 225,
		damping: 30,
		mass: 1,
		curve: "classic-bezier",
	},
};
export const SMOOTHING_FACTOR = 0.12;
export const ZOOM_TRANSLATION_DEADZONE_PX = 1.25;
export const ZOOM_SCALE_DEADZONE = 0.002;
export const AUTO_FOLLOW_SMOOTHING_FACTOR = 0.1;
export const AUTO_FOLLOW_SMOOTHING_FACTOR_MAX = 0.25;
export const AUTO_FOLLOW_RAMP_DISTANCE = 0.15;
// Reference frame interval so preview and export normalize their per-frame
// smoothing identically regardless of render fps. Lower fps = floatier follow
// (tuned to the live-preview feel).
export const AUTO_FOLLOW_REFERENCE_MS = 1000 / 40;
// Shared by preview and export so the camera follows the cursor identically.
export const AUTO_FOLLOW_PARAMS = {
	minFactor: AUTO_FOLLOW_SMOOTHING_FACTOR,
	maxFactor: AUTO_FOLLOW_SMOOTHING_FACTOR_MAX,
	rampDistance: AUTO_FOLLOW_RAMP_DISTANCE,
	referenceMs: AUTO_FOLLOW_REFERENCE_MS,
} as const;
