export interface PreparedFirstMatchSpan {
	start: number;
	end: number;
	itemIndex: number;
}

export interface PreparedFirstMatchSpans {
	spans: PreparedFirstMatchSpan[];
	starts: number[];
}

type Interval = { start: number; end: number };

function heapPush(heap: number[], value: number) {
	let index = heap.length;
	heap.push(value);
	while (index > 0) {
		const parent = (index - 1) >>> 1;
		if (heap[parent] <= value) break;
		heap[index] = heap[parent];
		index = parent;
	}
	heap[index] = value;
}

function heapPop(heap: number[]) {
	const last = heap.pop();
	if (last === undefined || heap.length === 0) return;
	let index = 0;
	while (true) {
		const left = index * 2 + 1;
		if (left >= heap.length) break;
		const right = left + 1;
		const child = right < heap.length && heap[right] < heap[left] ? right : left;
		if (heap[child] >= last) break;
		heap[index] = heap[child];
		index = child;
	}
	heap[index] = last;
}

/**
 * Converts overlapping half-open intervals into disjoint spans whose owner is
 * the first matching item in input order. The sweep is O(N log N); queries are
 * O(log N) and allocate nothing.
 */
export function prepareFirstMatchSpans(intervals: readonly Interval[]): PreparedFirstMatchSpans {
	const startsAt = new Map<number, number[]>();
	const endsAt = new Map<number, number[]>();
	const boundaries = new Set<number>();

	intervals.forEach((interval, itemIndex) => {
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
	const activeByPriority: number[] = [];
	const spans: PreparedFirstMatchSpan[] = [];

	for (let boundaryIndex = 0; boundaryIndex < sortedBoundaries.length - 1; boundaryIndex += 1) {
		const start = sortedBoundaries[boundaryIndex];
		const end = sortedBoundaries[boundaryIndex + 1];
		for (const itemIndex of endsAt.get(start) ?? []) active.delete(itemIndex);
		for (const itemIndex of startsAt.get(start) ?? []) {
			active.add(itemIndex);
			heapPush(activeByPriority, itemIndex);
		}
		while (activeByPriority.length > 0 && !active.has(activeByPriority[0])) {
			heapPop(activeByPriority);
		}
		const itemIndex = activeByPriority[0];
		if (itemIndex === undefined || end <= start) continue;
		const previous = spans.at(-1);
		if (previous?.itemIndex === itemIndex && previous.end === start) {
			previous.end = end;
		} else {
			spans.push({ start, end, itemIndex });
		}
	}

	return { spans, starts: spans.map((span) => span.start) };
}

export function findFirstMatchSpan(
	prepared: PreparedFirstMatchSpans,
	position: number,
): PreparedFirstMatchSpan | undefined {
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
