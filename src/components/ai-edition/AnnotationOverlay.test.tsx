// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AxcutAnnotationRegion } from "@/lib/ai-edition/schema";
import { AnnotationOverlay } from "./AnnotationOverlay";

const annotation: AxcutAnnotationRegion = {
	id: "ann_1",
	startMs: 0,
	endMs: 2_000,
	type: "text",
	content: "note",
	position: { x: 10, y: 20 },
	size: { width: 30, height: 20 },
	style: {
		color: "#fff",
		backgroundColor: "transparent",
		fontSize: 32,
		fontFamily: "Inter",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		textAlign: "center",
	},
	zIndex: 1,
};

const rndMocks = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("react-rnd", () => ({
	Rnd: (props: Record<string, unknown>) => {
		rndMocks.props = props;
		return <div data-testid="rnd">{props.children as React.ReactNode}</div>;
	},
}));

afterEach(() => {
	cleanup();
	rndMocks.props = null;
});

describe("AnnotationOverlay gesture publication", () => {
	it("keeps pointer frames local and publishes only the final position", () => {
		const onPositionChange = vi.fn();
		const onCommit = vi.fn();
		render(
			<AnnotationOverlay
				annotation={annotation}
				isSelected
				containerWidth={100}
				containerHeight={100}
				onPositionChange={onPositionChange}
				onRectChange={vi.fn()}
				onCommit={onCommit}
				onClick={vi.fn()}
				zIndex={1}
				isSelectedBoost
				renderContent
			/>,
		);
		const onDrag = rndMocks.props?.onDrag as (
			event: unknown,
			data: { x: number; y: number },
		) => void;
		const onDragStop = rndMocks.props?.onDragStop as typeof onDrag;
		act(() => {
			for (let value = 0; value < 60; value++) onDrag({}, { x: value, y: value });
		});
		expect(onPositionChange).not.toHaveBeenCalled();

		act(() => onDragStop({}, { x: 70, y: 80 }));
		expect(onPositionChange).toHaveBeenCalledOnce();
		expect(onPositionChange).toHaveBeenCalledWith("ann_1", { x: 70, y: 80 });
		expect(onCommit).toHaveBeenCalledOnce();
	});
});
