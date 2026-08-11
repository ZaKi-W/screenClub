import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type ComponentPropsWithoutRef, type PointerEvent, useEffect, useRef } from "react";
import styles from "./LaunchWindow.module.css";

const positionSpring = { stiffness: 520, damping: 34, mass: 0.45 };
const opacitySpring = { stiffness: 460, damping: 38, mass: 0.38 };

function clamp(value: number) {
	return Math.max(-1, Math.min(1, value));
}

function getPointerVector(event: PointerEvent<HTMLButtonElement>) {
	const bounds = event.currentTarget.getBoundingClientRect();
	return {
		x: clamp((event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)),
		y: clamp((event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)),
	};
}

type HudMagneticButtonProps = ComponentPropsWithoutRef<"button"> & {
	highlightClassName?: string;
};

/**
 * Reusable HUD hover physics. The control itself stays fixed while a separate
 * highlight plate follows the pointer and leaves in the pointer's direction.
 */
export function HudMagneticButton({
	children,
	className = "",
	highlightClassName = "",
	onPointerEnter,
	onPointerMove,
	onPointerLeave,
	onFocus,
	onBlur,
	...props
}: HudMagneticButtonProps) {
	const reduceMotion = useReducedMotion();
	const lastVector = useRef({ x: 0, y: 0 });
	const exitFadeTimer = useRef<number | null>(null);
	const targetX = useMotionValue(0);
	const targetY = useMotionValue(0);
	const targetScale = useMotionValue(0.94);
	const targetOpacity = useMotionValue(0);
	const x = useSpring(targetX, positionSpring);
	const y = useSpring(targetY, positionSpring);
	const scale = useSpring(targetScale, positionSpring);
	const opacity = useSpring(targetOpacity, opacitySpring);

	const cancelExitFade = () => {
		if (exitFadeTimer.current === null) return;
		window.clearTimeout(exitFadeTimer.current);
		exitFadeTimer.current = null;
	};

	useEffect(
		() => () => {
			if (exitFadeTimer.current !== null) window.clearTimeout(exitFadeTimer.current);
		},
		[],
	);

	const moveHighlight = (vector: { x: number; y: number }, entering = false) => {
		lastVector.current = vector;
		if (reduceMotion) {
			targetX.set(0);
			targetY.set(0);
		} else {
			targetX.set(vector.x * 4);
			targetY.set(vector.y * 3);
		}
		targetScale.set(entering ? 0.98 : 1);
		targetOpacity.set(1);
	};

	return (
		<button
			{...props}
			className={`${styles.hudMagneticButton} ${className}`}
			onPointerEnter={(event) => {
				cancelExitFade();
				const vector = getPointerVector(event);
				// A quick re-entry should continue from the in-flight exit instead of
				// jumping back to a fresh off-button starting position.
				if (!reduceMotion && opacity.get() < 0.08) {
					// Fresh entries mirror the exit gesture: begin just beyond the edge,
					// already faintly visible and contracted, then spring into place.
					x.jump(vector.x * 15);
					y.jump(vector.y * 12);
					scale.jump(0.82);
					opacity.jump(0.28);
				}
				moveHighlight(vector, true);
				onPointerEnter?.(event);
			}}
			onPointerMove={(event) => {
				moveHighlight(getPointerVector(event));
				onPointerMove?.(event);
			}}
			onPointerLeave={(event) => {
				cancelExitFade();
				const vector = getPointerVector(event);
				const exitVector =
					Math.abs(vector.x) + Math.abs(vector.y) > 0.2 ? vector : lastVector.current;
				if (reduceMotion) {
					targetX.set(0);
					targetY.set(0);
					targetScale.set(1);
					targetOpacity.set(0);
				} else {
					// Keep the plate visible for the first part of the gesture. This makes
					// the directional travel and contraction readable before it fades.
					targetX.set(exitVector.x * 15);
					targetY.set(exitVector.y * 12);
					targetScale.set(0.82);
					exitFadeTimer.current = window.setTimeout(() => {
						targetOpacity.set(0);
						exitFadeTimer.current = null;
					}, 65);
				}
				onPointerLeave?.(event);
			}}
			onFocus={(event) => {
				cancelExitFade();
				targetX.set(0);
				targetY.set(0);
				targetScale.set(1);
				targetOpacity.set(1);
				onFocus?.(event);
			}}
			onBlur={(event) => {
				cancelExitFade();
				targetScale.set(0.94);
				targetOpacity.set(0);
				onBlur?.(event);
			}}
		>
			<motion.span
				data-hud-magnetic-highlight="true"
				aria-hidden
				className={`${styles.hudMagneticHighlight} ${highlightClassName}`}
				style={{ x, y, scale, opacity }}
			/>
			{children}
		</button>
	);
}
