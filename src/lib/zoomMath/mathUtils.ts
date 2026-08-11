import { clamp01 } from "@/utils/math";
import { SCREEN_ANIMATION_SPRINGS, type ScreenAnimationStyle } from "./constants";

function sampleCubicBezier(a1: number, a2: number, t: number) {
	const oneMinusT = 1 - t;
	return 3 * a1 * oneMinusT * oneMinusT * t + 3 * a2 * oneMinusT * t * t + t * t * t;
}

function sampleCubicBezierDerivative(a1: number, a2: number, t: number) {
	const oneMinusT = 1 - t;
	return 3 * a1 * oneMinusT * oneMinusT + 6 * (a2 - a1) * oneMinusT * t + 3 * (1 - a2) * t * t;
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number) {
	const targetX = clamp01(t);
	let solvedT = targetX;

	for (let i = 0; i < 8; i += 1) {
		const currentX = sampleCubicBezier(x1, x2, solvedT) - targetX;
		const currentDerivative = sampleCubicBezierDerivative(x1, x2, solvedT);

		if (Math.abs(currentX) < 1e-6 || Math.abs(currentDerivative) < 1e-6) {
			break;
		}

		solvedT -= currentX / currentDerivative;
	}

	let lower = 0;
	let upper = 1;
	solvedT = clamp01(solvedT);

	for (let i = 0; i < 10; i += 1) {
		const currentX = sampleCubicBezier(x1, x2, solvedT);
		if (Math.abs(currentX - targetX) < 1e-6) {
			break;
		}

		if (currentX < targetX) {
			lower = solvedT;
		} else {
			upper = solvedT;
		}

		solvedT = (lower + upper) / 2;
	}

	return sampleCubicBezier(y1, y2, solvedT);
}

export function easeOutScreenStudio(t: number) {
	return cubicBezier(0.16, 1, 0.3, 1, t);
}

/**
 * Normalized camera response for the selected preset.
 *
 * x(t) = 1 - e^(-ωt)(1 + ωt), with ω = sqrt(k / m). The response is normalized at the
 * authored settle time so it reaches exactly 1 at the region boundary. Cinematic uses a
 * symmetric smootherstep and Classic deliberately preserves the previous front-loaded Bezier.
 */
export function screenSpringProgress(
	progress: number,
	style: ScreenAnimationStyle = "focused",
): number {
	const u = clamp01(progress);
	if (u <= 0) return 0;
	if (u >= 1 - 1e-9) return 1;
	const preset = SCREEN_ANIMATION_SPRINGS[style];
	if (preset.curve === "classic-bezier") {
		return easeOutScreenStudio(u);
	}
	if (preset.curve === "smootherstep") {
		return u * u * u * (u * (u * 6 - 15) + 10);
	}
	const omega = Math.sqrt(preset.stiffness / preset.mass);
	const durationSec = preset.durationMs / 1000;
	const response = (seconds: number) => 1 - Math.exp(-omega * seconds) * (1 + omega * seconds);
	return clamp01(response(u * durationSec) / response(durationSec));
}

/**
 * Ease-out cubic. Used for zoom-out transitions so strength eases to zero.
 */
export function easeOutCubic(t: number) {
	const x = clamp01(t);
	return 1 - Math.pow(1 - x, 3);
}
