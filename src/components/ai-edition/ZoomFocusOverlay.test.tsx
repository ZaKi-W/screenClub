// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AxcutZoomRegion } from "@/lib/ai-edition/schema";
import { ZoomFocusOverlay } from "./ZoomFocusOverlay";

const region: AxcutZoomRegion = {
	id: "zoom_1",
	startMs: 0,
	endMs: 2_000,
	depth: 2,
	focus: { cx: 0.5, cy: 0.5 },
	source: "manual",
};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("ZoomFocusOverlay live drag", () => {
	it("paints every pointer position but publishes only once per frame", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const onFocusChange = vi.fn();
		const { container } = render(
			<ZoomFocusOverlay region={region} isPlaying={false} onFocusChange={onFocusChange} />,
		);
		const overlay = container.firstElementChild as HTMLDivElement;
		Object.defineProperty(overlay, "getBoundingClientRect", {
			value: () => ({ left: 0, top: 0, width: 100, height: 100 }),
		});
		overlay.setPointerCapture = vi.fn();

		fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 50, clientY: 50 });
		for (let value = 51; value <= 90; value++) {
			fireEvent.pointerMove(overlay, { pointerId: 1, clientX: value, clientY: value });
		}
		expect(onFocusChange).not.toHaveBeenCalled();
		expect(frames).toHaveLength(1);

		act(() => frames.shift()?.(0));
		expect(onFocusChange).toHaveBeenCalledTimes(1);
		const [, focus] = onFocusChange.mock.calls[0] as [string, { cx: number; cy: number }];
		expect(focus.cx).toBeCloseTo(2 / 3);
		expect(focus.cy).toBeCloseTo(2 / 3);
	});
});
