// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The regression under test is geometric, so the environment has to have a size:
// jsdom reports 0 for every box, which would leave `pxPerSec` at 0 (the
// "unmeasured" case) and hide exactly the thing being checked.
const VIEWPORT_PX = 900;
const TOTAL_SEC = 1800; // a 30-minute recording, as in the report

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import type { useTimeline } from "@/lib/ai-edition/store/useTimeline";
import { V4Timeline } from "./V4Timeline";

beforeAll(() => {
	globalThis.ResizeObserver = class {
		// jsdom has none, and the width it would report is stubbed below anyway.
		observe() {
			/* noop */
		}
		unobserve() {
			/* noop */
		}
		disconnect() {
			/* noop */
		}
	} as unknown as typeof ResizeObserver;
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get: () => VIEWPORT_PX,
	});
	Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
		configurable: true,
		value: () => ({
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: VIEWPORT_PX,
			bottom: 100,
			width: VIEWPORT_PX,
			height: 100,
			toJSON() {
				/* unused by the component */
			},
		}),
	});
});

function clip(startSec: number, endSec: number) {
	return {
		id: `c@${startSec}`,
		assetId: "a1",
		timelineStartSec: startSec,
		timelineEndSec: endSec,
		sourceStartSec: 0,
		sourceEndSec: endSec - startSec,
	};
}

/** By default one 30-minute clip carrying a single one-second zoom region. */
function renderTimeline(
	clips = [clip(0, TOTAL_SEC)],
	zoom = {
		id: "zoom1",
		startMs: 10_000,
		endMs: 11_000,
		depth: 3 as const,
		focus: { x: 0.5, y: 0.5 },
	},
) {
	const tl = {
		clips,
		assets: [{ id: "a1", label: "rec", durationSec: TOTAL_SEC }],
		annotationRegions: [],
		speedRegions: [],
		cameraFullscreenRegions: [],
		zoomRegions: [zoom],
		trimRanges: [],
		selection: null,
		multiSelection: [],
		clipSelection: null,
		clearSelection: vi.fn(),
		selectRegion: vi.fn(),
		selectClip: vi.fn(),
		updateZoomSpan: vi.fn(async () => {
			/* the drag only awaits it */
		}),
		addZoom: vi.fn(async (_durationSec: number, _startSec: number) => {
			/* lane click only awaits it */
		}),
	};
	render(
		<V4Timeline
			// Only the members the lanes and the clip row read are mocked; the prop
			// stays typed as the real API rather than widened to `any` (AGENTS.md).
			tl={tl as unknown as ReturnType<typeof useTimeline>}
			setCurrentTime={vi.fn()}
			playing={false}
			onTogglePlay={vi.fn()}
			onPrevClip={vi.fn()}
			onNextClip={vi.fn()}
			onEditClip={vi.fn()}
		/>,
	);
	return {
		pill: screen.getByTitle("1.80×"),
		clipEls: Array.from(document.querySelectorAll<HTMLElement>("[data-clip-id]")),
		tl,
	};
}

/** Drag a handle by `dxPx`. The move/up listeners live on `window`, so the drag
 *  is driven by pointer deltas alone — the handle may re-mount under it. */
function dragHandle(handle: Element, dxPx: number) {
	fireEvent.pointerDown(handle, { clientX: 0 });
	window.dispatchEvent(new MouseEvent("pointermove", { clientX: dxPx }));
	window.dispatchEvent(new MouseEvent("pointerup", { clientX: dxPx }));
}

/** Ctrl+wheel up = zoom in; the handler is a native listener, so dispatch real events. */
function zoomIn(notches: number) {
	const canvas = document.querySelector("[class*=tlTracks]") as HTMLElement;
	for (let i = 0; i < notches; i++) {
		fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100, clientX: 0 });
	}
}

function timelineNavigationElements() {
	const tracks = document.querySelector<HTMLElement>("[class*=tlTracks]");
	const canvas = tracks?.firstElementChild as HTMLElement | null;
	if (!tracks || !canvas) throw new Error("Timeline navigation elements were not rendered");
	return { tracks, canvas };
}

describe("V4Timeline lane pills", () => {
	it("renders the zoom lane below the video clip row", () => {
		const { pill, clipEls } = renderTimeline();
		const clipsRow = clipEls[0]?.parentElement;
		const zoomLane = pill.parentElement;
		expect(clipsRow).not.toBeNull();
		expect(zoomLane).not.toBeNull();
		expect(clipsRow?.compareDocumentPosition(zoomLane as Node) ?? 0).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
	});

	it("adds a zoom at the clicked position on the zoom lane", () => {
		const { pill, tl } = renderTimeline();
		const zoomLane = pill.parentElement;
		expect(zoomLane).not.toBeNull();

		fireEvent.pointerDown(zoomLane as HTMLElement, { clientX: VIEWPORT_PX / 2 });
		fireEvent.click(zoomLane as HTMLElement, { clientX: VIEWPORT_PX / 2 });

		expect(tl.addZoom).toHaveBeenCalledOnce();
		expect(tl.addZoom.mock.calls[0]?.[1]).toBeCloseTo(TOTAL_SEC / 2, 6);
	});

	it("does not add another zoom when an existing zoom pill is clicked", () => {
		const { pill, tl } = renderTimeline();

		fireEvent.click(pill, { clientX: VIEWPORT_PX / 2 });

		expect(tl.addZoom).not.toHaveBeenCalled();
	});

	it("draws a pill exactly as wide as its region, at any zoom", () => {
		// 1 s of 1800 s. The old `Math.max(1.5, …)` floor drew this as 1.5% — 27
		// seconds of ruler for a one-second region — and did it at every zoom,
		// since the floor was a percentage of the timeline rather than of the screen.
		const { pill } = renderTimeline();
		const expected = (1 / TOTAL_SEC) * 100;
		expect(Number.parseFloat(pill.style.width)).toBeCloseTo(expected, 6);

		// The canvas is what scales with zoom, so the pill's share of it must not
		// move at all — only the chrome inside it may react (below).
		zoomIn(40);
		expect(Number.parseFloat(pill.style.width)).toBeCloseTo(expected, 6);
	});

	it("keeps both resize handles reachable when the pill is thinner than they are", () => {
		// 0.5 px wide at this zoom: the handles cannot sit inside the box without
		// swallowing it whole, so they mount outside it and the body stays a move
		// target. Resizing a hairline stays possible — it is the pointer precision
		// that is coarse there, not the affordance that is missing.
		const { pill } = renderTimeline();
		const [left, right] = Array.from(pill.querySelectorAll("span"));
		expect(left.style.left).toBe("-10px");
		expect(right.style.right).toBe("-10px");
		// Nothing legible fits, so no icon/label is rendered (the title attribute
		// still carries the value on hover).
		expect(pill.textContent).toBe("");

		// Zoomed to the 50× ceiling the same second is 25 px wide and hosts its own
		// chrome again.
		zoomIn(40);
		expect(left.style.left).toBe("0px");
		expect(right.style.right).toBe("0px");
	});

	it("grows and shrinks a hairline pill from its outside handles", () => {
		// Growing is unbounded by the pill's own size: 90 px right of a 900 px canvas
		// is a tenth of the 1800 s timeline, so the 10–11 s zoom ends at 191 s.
		// The chrome re-flows inside the box as it crosses PILL_HANDLES_MIN_PX
		// mid-drag, which the gesture never notices — the deltas come from the
		// pointer and the listeners live on `window`, not on the handle.
		const { pill, tl } = renderTimeline();
		const [left, right] = Array.from(pill.querySelectorAll("span"));
		dragHandle(right, 90);
		expect(tl.updateZoomSpan).toHaveBeenCalledWith("zoom1", 10_000, 191_000);

		// Shrinking stops at the storage grid (1 ms), not at the old flat 200 ms
		// floor that refused the last fifth of a second however far you zoomed in.
		dragHandle(left, 90_000);
		expect(tl.updateZoomSpan).toHaveBeenLastCalledWith("zoom1", 10_999, 11_000);

		// 18 s short of the timeline end: 9 px away on screen, so it stays where it
		// was dropped. The snap radius used to be 1.2% of the timeline — a 21-second
		// magnet here — which is what made a grown edge jump to a clip boundary it
		// was nowhere near, the more so the longer the recording.
		dragHandle(right, 885.5);
		expect(tl.updateZoomSpan).toHaveBeenLastCalledWith("zoom1", 10_000, 1_782_000);
	});
});

describe("V4Timeline wheel navigation", () => {
	it("pans a zoomed timeline with a mouse wheel", () => {
		renderTimeline();
		zoomIn(4);
		const { tracks, canvas } = timelineNavigationElements();
		const before = canvas.style.transform;

		fireEvent.wheel(tracks, { deltaY: 120, clientX: VIEWPORT_PX / 2 });

		expect(canvas.style.transform).not.toBe(before);
	});

	it("pans a zoomed timeline with a horizontal trackpad swipe", () => {
		renderTimeline();
		zoomIn(4);
		const { tracks, canvas } = timelineNavigationElements();
		const before = canvas.style.transform;

		fireEvent.wheel(tracks, { deltaX: 80, deltaY: 2, clientX: VIEWPORT_PX / 2 });

		expect(canvas.style.transform).not.toBe(before);
	});

	it("keeps Command+wheel available for zooming", () => {
		renderTimeline();
		const { tracks, canvas } = timelineNavigationElements();
		const before = canvas.style.width;

		fireEvent.wheel(tracks, { metaKey: true, deltaY: -100, clientX: VIEWPORT_PX / 2 });

		expect(canvas.style.width).not.toBe(before);
	});
});

describe("V4Timeline clip row", () => {
	// Three clips = two junctions. As a flex row with `gap: 6px`, each junction
	// added 6px while every clip shrank proportionally to pay for it, so a clip's
	// left edge missed its true start: measured in a browser on this very fixture,
	// clip 2 by +2px and clip 3 by +6px, while the pills and ruler above them sat
	// at the true position. Being a fixed px error in a proportional layout, it was
	// worth 5 s and 15 s of timeline zoomed out but a fraction of a second zoomed
	// in — which is what reads as "the pills move when I zoom".
	const CLIPS = [clip(0, 600), clip(600, 900), clip(900, TOTAL_SEC)];
	const startsAt = (sec: number) => `${(sec / TOTAL_SEC) * 100}%`;

	it("anchors every clip to its own start time, and keeps it there under zoom", () => {
		// The zoom starts exactly where the second clip does, so the pill and
		// the clip edge under it must resolve to the very same coordinate.
		const { clipEls, pill } = renderTimeline(CLIPS, {
			id: "zoom1",
			startMs: 600_000,
			endMs: 601_000,
			depth: 3,
			focus: { x: 0.5, y: 0.5 },
		});
		expect(clipEls.map((el) => el.style.left)).toEqual([startsAt(0), startsAt(600), startsAt(900)]);
		expect(pill.style.left).toBe(clipEls[1].style.left);

		// Zoom scales the canvas these coordinates live in, so the coordinates
		// themselves must not move: same values, same agreement with the pill.
		zoomIn(40);
		expect(clipEls.map((el) => el.style.left)).toEqual([startsAt(0), startsAt(600), startsAt(900)]);
		expect(pill.style.left).toBe(clipEls[1].style.left);
	});

	it("takes the card gutter out of each clip's own width", () => {
		// The 6px is what separates two cards. Taken off the clip's width it stays
		// local to that clip; inserted between them (a flex gap) it displaced every
		// clip that followed. The 1px floor keeps a clip shorter than the gutter
		// from collapsing to nothing on a long timeline.
		const { clipEls } = renderTimeline(CLIPS);
		const widths = clipEls.map((el) => el.style.width);
		// (jsdom re-serialises the percentage to 4 decimals, hence the numeric read)
		expect(widths.map((w) => w.endsWith("- 6px)"))).toEqual([true, true, true]);
		for (const [i, durSec] of [600, 300, 900].entries()) {
			expect(Number.parseFloat(widths[i].slice("calc(".length))).toBeCloseTo(
				(durSec / TOTAL_SEC) * 100,
				3,
			);
		}
	});
});
