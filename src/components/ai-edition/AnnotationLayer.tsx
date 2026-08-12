// Port of the annotation-rendering block inline in `VideoPlayback.tsx`
// (lines ~1988-2115 on main) as a standalone component. Main splits
// "annotation" and "blur" into two separate arrays/selection ids; the new
// editor's schema keeps all annotation types (including blur) in one
// `document.annotations[]` array, so this uses a single filtered+sorted
// list and a single selection id instead.

import { useSyncExternalStore } from "react";
import type { AxcutAnnotationRegion } from "@/lib/ai-edition/schema";
import type { PlaybackClockRef } from "@/lib/ai-edition/timeline/playback-clock";
import { AnnotationOverlay } from "./AnnotationOverlay";

const subscribeToNothing = () => () => undefined;

interface AnnotationLayerProps {
	annotations: AxcutAnnotationRegion[];
	selectedAnnotationId: string | null;
	currentTimeSec: number;
	containerWidth: number;
	containerHeight: number;
	onSelectAnnotation: (id: string) => void;
	onPositionChange: (id: string, position: { x: number; y: number }) => void;
	onRectChange: (
		id: string,
		patch: {
			position: { x: number; y: number };
			size: { width: number; height: number };
		},
	) => void;
	onCommit: () => void;
	/** Paint pixels in the lightweight renderer. Native quality mode paints them itself. */
	renderContent?: boolean;
	/** Renderer visual clock; annotation React work only wakes when visibility actually changes. */
	clockRef?: PlaybackClockRef;
}

export function AnnotationLayer({
	annotations,
	selectedAnnotationId,
	currentTimeSec,
	containerWidth,
	containerHeight,
	onSelectAnnotation,
	onPositionChange,
	onRectChange,
	onCommit,
	renderContent = false,
	clockRef,
}: AnnotationLayerProps) {
	const getVisibilitySnapshot = () => {
		const timeMs = Math.round((clockRef?.current.virtualTimeSec ?? currentTimeSec) * 1000);
		return annotations
			.filter(
				(annotation) =>
					annotation.id === selectedAnnotationId ||
					(timeMs >= annotation.startMs && timeMs < annotation.endMs),
			)
			.map((annotation) => annotation.id)
			.join("|");
	};
	// Snapshot equality suppresses all intermediate 60 Hz React renders. The
	// component wakes only when crossing an annotation boundary.
	useSyncExternalStore(
		clockRef?.subscribe ?? subscribeToNothing,
		getVisibilitySnapshot,
		getVisibilitySnapshot,
	);
	const currentTimeMs = Math.round((clockRef?.current.virtualTimeSec ?? currentTimeSec) * 1000);

	const visible = annotations
		.filter((annotation) => {
			if (typeof annotation.startMs !== "number" || typeof annotation.endMs !== "number") {
				return false;
			}
			if (annotation.id === selectedAnnotationId) return true;
			return currentTimeMs >= annotation.startMs && currentTimeMs < annotation.endMs;
		})
		.sort((a, b) => a.zIndex - b.zIndex);

	const handleClick = (clickedId: string) => {
		if (clickedId === selectedAnnotationId && visible.length > 1) {
			const currentIndex = visible.findIndex((a) => a.id === clickedId);
			const nextIndex = (currentIndex + 1) % visible.length;
			onSelectAnnotation(visible[nextIndex].id);
		} else {
			onSelectAnnotation(clickedId);
		}
	};

	if (containerWidth <= 0 || containerHeight <= 0) return null;

	return (
		<div className="absolute inset-0" style={{ pointerEvents: "none" }}>
			{visible.map((annotation) => (
				<AnnotationOverlay
					// La clé ne porte plus les champs de `blurData` : ils forçaient un remontage à
					// chaque réglage du flou, pour resynchroniser un canvas de mosaïque qui n'existe
					// plus. La taille du conteneur y reste, elle, parce qu'elle change le rect en px.
					key={`${annotation.id}-${containerWidth}-${containerHeight}`}
					annotation={annotation}
					isSelected={annotation.id === selectedAnnotationId}
					containerWidth={containerWidth}
					containerHeight={containerHeight}
					onPositionChange={onPositionChange}
					onRectChange={onRectChange}
					onCommit={onCommit}
					renderContent={renderContent}
					onClick={handleClick}
					zIndex={annotation.zIndex}
					isSelectedBoost={annotation.id === selectedAnnotationId}
				/>
			))}
		</div>
	);
}
