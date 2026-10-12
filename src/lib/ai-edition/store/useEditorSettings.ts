// React binding over the editor-settings pure module.
//
// Usage:
//   const { settings, set, setLive } = useEditorSettings();
//   - `settings` is a typed snapshot of the document's legacy settings.
//   - `set(patch)` writes + commits to disk (use for toggles, selects, on
//     slider release).
//   - `setLive(patch)` updates a transient, frame-coalesced preview layer.
//   - `commit()` writes that layer to the document/history/disk once at gesture end.
//
// The hook is intentionally thin: it reads from the project store, applies
// the patch through `patchEditorSettings`, and persists via the store. No
// Persisted state remains in the document; continuous gestures intentionally stay outside it.

import { create } from "zustand";
import type { AxcutDocument } from "../schema";
import {
	type EditorSettingsPatch,
	type EditorSettingsSnapshot,
	getEditorSettings,
	mergeEditorSettingsPatches,
	patchEditorSettings,
} from "./editorSettings";
import { useProjectStore } from "./projectStore";

export interface UseEditorSettingsResult {
	settings: EditorSettingsSnapshot;
	/** True when there's a project loaded — `set`/`setLive` are no-ops otherwise. */
	hasDocument: boolean;
	/** Apply a patch, persist to disk. */
	set: (patch: EditorSettingsPatch) => Promise<void>;
	/** Apply a patch, no persist. Pair with `commit` on slider release. */
	setLive: (patch: EditorSettingsPatch) => void;
	/** Force-flush the current document to disk. */
	commit: () => Promise<void>;
}

interface LiveEditorSettingsState {
	projectId: string | null;
	patch: EditorSettingsPatch;
}

const useLiveEditorSettingsStore = create<LiveEditorSettingsState>(() => ({
	projectId: null,
	patch: {},
}));

let queuedProjectId: string | null = null;
let queuedPatch: EditorSettingsPatch = {};
let liveFrame: number | null = null;

function publishQueuedLivePatch(): void {
	if (liveFrame !== null && typeof cancelAnimationFrame === "function") {
		cancelAnimationFrame(liveFrame);
	}
	liveFrame = null;
	const projectId = queuedProjectId;
	const patch = queuedPatch;
	queuedProjectId = null;
	queuedPatch = {};
	if (!projectId || Object.keys(patch).length === 0) return;
	useLiveEditorSettingsStore.setState((state) => ({
		projectId,
		patch: state.projectId === projectId ? mergeEditorSettingsPatches(state.patch, patch) : patch,
	}));
}

function queueLivePatch(document: AxcutDocument, patch: EditorSettingsPatch): void {
	const projectId = document.project.id;
	if (queuedProjectId !== projectId) {
		queuedProjectId = projectId;
		queuedPatch = {};
	}
	queuedPatch = mergeEditorSettingsPatches(queuedPatch, patch);
	if (liveFrame !== null) return;
	if (typeof requestAnimationFrame !== "function") {
		publishQueuedLivePatch();
		return;
	}
	liveFrame = requestAnimationFrame(publishQueuedLivePatch);
}

function takeLivePatch(document: AxcutDocument): EditorSettingsPatch {
	publishQueuedLivePatch();
	const state = useLiveEditorSettingsStore.getState();
	const patch = state.projectId === document.project.id ? state.patch : {};
	useLiveEditorSettingsStore.setState({ projectId: null, patch: {} });
	return patch;
}

let cachedDocument: AxcutDocument | null = null;
let cachedLive: LiveEditorSettingsState | null = null;
let cachedSettings: EditorSettingsSnapshot | null = null;

function getEffectiveSettings(
	document: AxcutDocument | null,
	live: LiveEditorSettingsState,
): EditorSettingsSnapshot {
	if (document === cachedDocument && live === cachedLive && cachedSettings) return cachedSettings;
	cachedDocument = document;
	cachedLive = live;
	cachedSettings =
		document && live.projectId === document.project.id
			? getEditorSettings(patchEditorSettings(document, live.patch))
			: getEditorSettings(document);
	return cachedSettings;
}

interface EffectiveEditorSettingsState {
	settings: EditorSettingsSnapshot;
}

const readEffectiveSettings = () =>
	getEffectiveSettings(useProjectStore.getState().document, useLiveEditorSettingsStore.getState());

const useEffectiveEditorSettingsStore = create<EffectiveEditorSettingsState>(() => ({
	settings: readEffectiveSettings(),
}));

const publishEffectiveSettings = () => {
	useEffectiveEditorSettingsStore.setState({ settings: readEffectiveSettings() });
};

// One module-level bridge combines the persisted document and transient overlay.
// Components subscribe to the derived selector store below, so an unrelated
// document replacement does not wake them before their selected value is known.
useProjectStore.subscribe((state, previousState) => {
	if (state.document !== previousState.document) publishEffectiveSettings();
});
useLiveEditorSettingsStore.subscribe(publishEffectiveSettings);

/**
 * Subscribe to exactly the editor setting a component renders. A primitive selector therefore
 * stays silent when a different slider publishes its transient patch, instead of waking every
 * inspector, toolbar and preview subtree once per animation frame.
 */
export function useEditorSettingsValue<T>(selector: (settings: EditorSettingsSnapshot) => T): T {
	return useEffectiveEditorSettingsStore((state) => selector(state.settings));
}

export interface UseEditorSettingsActions {
	/** Apply a patch, persist to disk. */
	set: (patch: EditorSettingsPatch) => Promise<void>;
	/** Apply a patch, no persist. Pair with `commit` on slider release. */
	setLive: (patch: EditorSettingsPatch) => void;
	/** Force-flush the current document to disk. */
	commit: () => Promise<void>;
}

const editorSettingsActions: UseEditorSettingsActions = {
	async set(patch) {
		const state = useProjectStore.getState();
		const doc = state.document;
		if (!doc) return;
		const livePatch = takeLivePatch(doc);
		const next = patchEditorSettings(doc, mergeEditorSettingsPatches(livePatch, patch));
		state.setDocument(next);
		await state.saveDocument(next);
	},
	setLive(patch) {
		const doc = useProjectStore.getState().document;
		if (!doc) return;
		queueLivePatch(doc, patch);
	},
	async commit() {
		const state = useProjectStore.getState();
		const doc = state.document;
		if (!doc) return;
		const patch = takeLivePatch(doc);
		const next = patchEditorSettings(doc, patch);
		if (Object.keys(patch).length > 0) state.setDocumentLive(next);
		state.commitLiveDocumentHistory();
		await state.saveDocument(next);
	},
};

/** Stable write-only settings API. It does not subscribe the caller to transient values. */
export function useEditorSettingsActions(): UseEditorSettingsActions {
	return editorSettingsActions;
}

export function useEditorSettings(): UseEditorSettingsResult {
	const settings = useEditorSettingsValue((value) => value);
	const hasDocument = useProjectStore((state) => state.document !== null);
	return { settings, hasDocument, ...editorSettingsActions };
}
