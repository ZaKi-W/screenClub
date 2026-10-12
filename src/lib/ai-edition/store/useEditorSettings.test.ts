// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxcutDocument } from "../schema";
import { axcutSchemaVersion } from "../schema";
import { getEditorSettings } from "./editorSettings";
import { useProjectStore } from "./projectStore";
import {
	useEditorSettings,
	useEditorSettingsActions,
	useEditorSettingsValue,
} from "./useEditorSettings";

const bridgeMocks = vi.hoisted(() => ({
	save: vi.fn(async (document: AxcutDocument) => ({ success: true, document })),
}));

vi.mock("@/native/client", () => ({
	nativeBridgeClient: {
		aiEdition: { save: bridgeMocks.save },
	},
}));

const document: AxcutDocument = {
	schemaVersion: axcutSchemaVersion,
	project: {
		id: "settings-perf",
		title: "Settings performance",
		createdAt: "2026-08-12T00:00:00.000Z",
		updatedAt: "2026-08-12T00:00:00.000Z",
	},
	assets: [],
	timeline: {
		clips: [],
		gaps: [],
		trimRanges: [],
		muteRanges: [],
		speedRanges: [],
		captionRanges: [],
	},
	annotations: [],
	zoomRanges: [],
	transcripts: [],
	transcript: null,
	legacyEditor: null,
};

describe("useEditorSettings live updates", () => {
	let frames: Array<FrameRequestCallback>;

	beforeEach(() => {
		bridgeMocks.save.mockClear();
		frames = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			frames[handle - 1] = () => undefined;
		});
		useProjectStore.setState({ document, revision: 0, dirty: false });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		useProjectStore.getState().clear();
	});

	it("keeps live values transient and writes the document once on commit", async () => {
		const { result } = renderHook(() => useEditorSettings());
		act(() => {
			result.current.setLive({ shadowIntensity: 0.2 });
			result.current.setLive({ shadowIntensity: 0.5 });
			result.current.setLive({ padding: 24 });
		});
		expect(useProjectStore.getState().revision).toBe(0);

		act(() => {
			for (const callback of frames.splice(0)) callback(performance.now());
		});

		expect(useProjectStore.getState().revision).toBe(0);
		expect(result.current.settings.shadowIntensity).toBe(0.5);
		expect(result.current.settings.padding).toBe(24);

		await act(async () => result.current.commit());
		const state = useProjectStore.getState();
		expect(state.revision).toBe(2);
		expect(getEditorSettings(state.document).shadowIntensity).toBe(0.5);
		expect(getEditorSettings(state.document).padding).toBe(24);
		expect(bridgeMocks.save).toHaveBeenCalledTimes(1);
	});

	it("does not render a field selector for unrelated live patches", () => {
		let renders = 0;
		const { result } = renderHook(() => {
			renders += 1;
			return {
				aspectRatio: useEditorSettingsValue((settings) => settings.aspectRatio),
				actions: useEditorSettingsActions(),
			};
		});
		expect(renders).toBe(1);

		act(() => {
			result.current.actions.setLive({ shadowIntensity: 0.8 });
			for (const callback of frames.splice(0)) callback(performance.now());
		});

		expect(result.current.aspectRatio).toBe("native");
		expect(renders).toBe(1);
	});

	it("does not render a field selector for unrelated document replacements", () => {
		let renders = 0;
		const { result } = renderHook(() => {
			renders += 1;
			return useEditorSettingsValue((settings) => settings.aspectRatio);
		});
		expect(renders).toBe(1);

		act(() => {
			const current = useProjectStore.getState().document;
			if (!current) throw new Error("missing fixture document");
			useProjectStore.setState({
				document: { ...current, annotations: [...current.annotations] },
			});
		});

		expect(result.current).toBe("native");
		expect(renders).toBe(1);
	});

	it("keeps settings actions stable while live values publish", () => {
		const { result } = renderHook(() => ({
			shadow: useEditorSettingsValue((settings) => settings.shadowIntensity),
			actions: useEditorSettingsActions(),
		}));
		const actions = result.current.actions;

		act(() => {
			result.current.actions.setLive({ shadowIntensity: 0.7 });
			for (const callback of frames.splice(0)) callback(performance.now());
		});

		expect(result.current.shadow).toBe(0.7);
		expect(result.current.actions.set).toBe(actions.set);
		expect(result.current.actions.setLive).toBe(actions.setLive);
		expect(result.current.actions.commit).toBe(actions.commit);
	});

	it("commits a queued patch after the same project document object is replaced", async () => {
		const { result } = renderHook(() => useEditorSettingsActions());
		act(() => result.current.setLive({ padding: 36 }));

		const replacement = {
			...document,
			project: { ...document.project, updatedAt: "2026-08-12T01:00:00.000Z" },
		};
		act(() => useProjectStore.setState({ document: replacement }));
		await act(async () => result.current.commit());

		expect(getEditorSettings(useProjectStore.getState().document).padding).toBe(36);
		expect(bridgeMocks.save).toHaveBeenCalledTimes(1);
	});

	it("does not leak a queued patch into another project", async () => {
		const { result } = renderHook(() => useEditorSettingsActions());
		act(() => result.current.setLive({ padding: 48 }));
		const otherDocument = {
			...document,
			project: { ...document.project, id: "settings-perf-other" },
		};
		act(() => useProjectStore.setState({ document: otherDocument }));
		await act(async () => result.current.commit());

		expect(getEditorSettings(useProjectStore.getState().document).padding).toBe(0);
	});
});
