import type { AxcutAnnotationRegion } from "../schema";
import {
	type ActiveIntervalIndex,
	type ActiveIntervalSpan,
	findActiveIntervalSpan,
	prepareActiveIntervalSpans,
} from "./active-interval-index";

export interface PreparedAnnotationVisibility {
	annotations: AxcutAnnotationRegion[];
	annotationById: Map<string, AxcutAnnotationRegion>;
	activeIntervals: ActiveIntervalIndex;
	visibleBySpan: Map<ActiveIntervalSpan, AxcutAnnotationRegion[]>;
}

export function prepareAnnotationVisibility(
	annotations: AxcutAnnotationRegion[],
): PreparedAnnotationVisibility {
	const activeIntervals = prepareActiveIntervalSpans(
		annotations.map((annotation) => ({ start: annotation.startMs, end: annotation.endMs })),
	);
	return {
		annotations,
		annotationById: new Map(annotations.map((annotation) => [annotation.id, annotation])),
		activeIntervals,
		visibleBySpan: new Map(
			activeIntervals.spans.map((span) => [
				span,
				span.itemIndexes
					.map((itemIndex) => annotations[itemIndex])
					.filter((annotation) => annotation !== undefined)
					.sort((left, right) => left.zIndex - right.zIndex),
			]),
		),
	};
}

export function findAnnotationVisibilitySpan(
	prepared: PreparedAnnotationVisibility,
	timeMs: number,
): ActiveIntervalSpan | undefined {
	return findActiveIntervalSpan(prepared.activeIntervals, timeMs);
}

/**
 * Returns a pre-sorted shared array for the usual playback path. Selection is
 * appended and sorted only when an inactive annotation must stay editable.
 */
export function resolveVisibleAnnotations(
	prepared: PreparedAnnotationVisibility,
	timeMs: number,
	selectedAnnotationId: string | null,
): AxcutAnnotationRegion[] {
	const span = findAnnotationVisibilitySpan(prepared, timeMs);
	const active = span ? (prepared.visibleBySpan.get(span) ?? []) : [];
	if (
		!selectedAnnotationId ||
		active.some((annotation) => annotation.id === selectedAnnotationId)
	) {
		return active;
	}
	const selected = prepared.annotationById.get(selectedAnnotationId);
	if (!selected) return active;
	return [...active, selected].sort((left, right) => left.zIndex - right.zIndex);
}
