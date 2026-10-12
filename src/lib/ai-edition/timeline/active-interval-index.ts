export interface ActiveIntervalSpan {
	start: number;
	end: number;
	/** Input-order indexes active throughout this half-open span. */
	itemIndexes: number[];
}

export interface ActiveIntervalIndex {
	spans: ActiveIntervalSpan[];
	starts: number[];
}

type Interval = { start: number; end: number };

function sameIndexes(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Prepares every distinct active-membership span for overlapping half-open
 * intervals. Construction happens when authored regions change; point queries
 * on the visual clock are allocation-free O(log N).
 */
export function prepareActiveIntervalSpans(intervals: readonly Interval[]): ActiveIntervalIndex {
	const startsAt = new Map<number, number[]>();
	const endsAt = new Map<number, number[]>();
	const boundaries = new Set<number>();

	intervals.forEach((interval, itemIndex) => {
		if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) return;
		if (!(interval.end > interval.start)) return;
		boundaries.add(interval.start);
		boundaries.add(interval.end);
		const starts = startsAt.get(interval.start);
		if (starts) starts.push(itemIndex);
		else startsAt.set(interval.start, [itemIndex]);
		const ends = endsAt.get(interval.end);
		if (ends) ends.push(itemIndex);
		else endsAt.set(interval.end, [itemIndex]);
	});

	const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
	const active = new Set<number>();
	const spans: ActiveIntervalSpan[] = [];

	for (let boundaryIndex = 0; boundaryIndex < sortedBoundaries.length - 1; boundaryIndex += 1) {
		const start = sortedBoundaries[boundaryIndex];
		const end = sortedBoundaries[boundaryIndex + 1];
		// Closing edges are processed before opening edges, preserving [start, end).
		for (const itemIndex of endsAt.get(start) ?? []) active.delete(itemIndex);
		for (const itemIndex of startsAt.get(start) ?? []) active.add(itemIndex);
		if (active.size === 0 || end <= start) continue;
		const itemIndexes = [...active].sort((left, right) => left - right);
		const previous = spans.at(-1);
		if (previous?.end === start && sameIndexes(previous.itemIndexes, itemIndexes)) {
			previous.end = end;
		} else {
			spans.push({ start, end, itemIndexes });
		}
	}

	return { spans, starts: spans.map((span) => span.start) };
}

export function findActiveIntervalSpan(
	prepared: ActiveIntervalIndex,
	position: number,
): ActiveIntervalSpan | undefined {
	let low = 0;
	let high = prepared.starts.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (prepared.starts[middle] <= position) low = middle + 1;
		else high = middle;
	}
	const span = prepared.spans[low - 1];
	return span && position >= span.start && position < span.end ? span : undefined;
}
