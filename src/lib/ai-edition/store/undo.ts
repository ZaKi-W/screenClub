// Lightweight undo/redo for the project document. The store fires
// `documentChanged` whenever `setDocument` is called; subscribers record
// snapshots up to a bounded history. Cmd+Z / Cmd+Shift+Z use the snapshot
// stack to roll back / roll forward. Designed to be small and side-effect
// free so it works in any renderer.

import { useEffect, useRef } from "react";
import type { AxcutDocument } from "../schema";
import { useProjectStore } from "./projectStore";

type Snapshot = { projectId: string; doc: unknown };

const MAX_HISTORY = 50;
const past: Snapshot[] = [];
const future: Snapshot[] = [];

export function pushHistory(snapshot: Snapshot) {
	past.push(snapshot);
	if (past.length > MAX_HISTORY) past.shift();
	future.length = 0;
}

export function clearHistory() {
	past.length = 0;
	future.length = 0;
}

export function undo(): boolean {
	const prev = past.pop();
	if (!prev) return false;
	const state = useProjectStore.getState();
	if (!state.projectId || state.projectId !== prev.projectId) {
		clearHistory();
		return false;
	}
	const doc = state.document;
	if (doc) future.push({ projectId: prev.projectId, doc: structuredClone(doc) });
	useProjectStore.setState((current) => ({
		document: structuredClone(prev.doc) as AxcutDocument,
		revision: current.revision + 1,
		dirty: true,
	}));
	return true;
}

export function redo(): boolean {
	const next = future.pop();
	if (!next) return false;
	const state = useProjectStore.getState();
	if (!state.projectId || state.projectId !== next.projectId) {
		clearHistory();
		return false;
	}
	const doc = state.document;
	if (doc) past.push({ projectId: doc.project.id, doc: structuredClone(doc) });
	useProjectStore.setState((current) => ({
		document: structuredClone(next.doc) as AxcutDocument,
		revision: current.revision + 1,
		dirty: true,
	}));
	return true;
}

export function useUndoRedoShortcuts(onAfter: () => void) {
	const onAfterRef = useRef(onAfter);
	onAfterRef.current = onAfter;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
			if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
			const ctrl = e.ctrlKey || e.metaKey;
			if (ctrl && e.shiftKey && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (redo()) onAfterRef.current();
				return;
			}
			if (ctrl && e.key.toLowerCase() === "y") {
				e.preventDefault();
				if (redo()) onAfterRef.current();
				return;
			}
			if (ctrl && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (undo()) onAfterRef.current();
				return;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}
