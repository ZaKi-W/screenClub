// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSettings = vi.fn(() => Promise.resolve());
const editorSettings = {
	settings: { aspectRatio: "native" },
	hasDocument: true,
	set: setSettings,
};

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => key,
}));

vi.mock("@/lib/ai-edition/store/useEditorSettings", () => ({
	useEditorSettings: () => editorSettings,
}));

import { PreviewToolbar } from "./PreviewToolbar";

describe("PreviewToolbar", () => {
	beforeEach(() => {
		setSettings.mockClear();
		editorSettings.settings.aspectRatio = "native";
		editorSettings.hasDocument = true;
	});

	it("shows the localized Auto label instead of an unresolved timeline key", () => {
		render(<PreviewToolbar canCrop onCrop={vi.fn()} />);
		expect(screen.getByRole("button", { name: "aspectRatio.label" })).toHaveTextContent(
			"aspectRatio.auto",
		);
	});

	it("offers the Screen Studio preset set in the same order", () => {
		render(<PreviewToolbar canCrop onCrop={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "aspectRatio.label" }));
		expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
			"aspectRatio.auto",
			"aspectRatio.wide",
			"aspectRatio.square",
			"aspectRatio.classic",
			"aspectRatio.vertical",
			"aspectRatio.tall",
			"aspectRatio.portrait",
		]);
	});

	it("persists the selected ratio and closes the menu", async () => {
		render(<PreviewToolbar canCrop onCrop={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "aspectRatio.label" }));
		fireEvent.click(screen.getByRole("menuitemradio", { name: "aspectRatio.tall" }));
		expect(setSettings).toHaveBeenCalledWith({ aspectRatio: "3:4" });
		await waitFor(() => expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument());
	});

	it("is disabled when no project is open", () => {
		editorSettings.hasDocument = false;
		render(<PreviewToolbar canCrop={false} onCrop={vi.fn()} />);
		expect(screen.getByRole("button", { name: "aspectRatio.label" })).toBeDisabled();
	});
});
