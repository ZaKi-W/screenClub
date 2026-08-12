import { create } from "zustand";

export type PreviewPerformanceMode = "quality" | "performance" | "power-saving";

export interface PreviewPerformancePolicy {
	mode: PreviewPerformanceMode;
	/** Maximum cadence for outer React/Zustand playhead updates. Visual presentation is separate. */
	uiFps: number;
	/** The native compositor is retained only for exact preview/export parity. */
	useNativeCompositor: boolean;
}

const STORAGE_KEY = "openscreen.preview-performance-mode";

const POLICIES: Record<PreviewPerformanceMode, PreviewPerformancePolicy> = {
	quality: {
		mode: "quality",
		uiFps: 60,
		useNativeCompositor: true,
	},
	performance: {
		mode: "performance",
		uiFps: 30,
		useNativeCompositor: false,
	},
	"power-saving": {
		mode: "power-saving",
		uiFps: 15,
		useNativeCompositor: false,
	},
};

function readInitialMode(): PreviewPerformanceMode {
	if (typeof window === "undefined") return "performance";
	try {
		const value = window.localStorage.getItem(STORAGE_KEY);
		return value === "quality" || value === "performance" || value === "power-saving"
			? value
			: "performance";
	} catch {
		return "performance";
	}
}

interface PreviewPerformanceState {
	mode: PreviewPerformanceMode;
	setMode: (mode: PreviewPerformanceMode) => void;
}

export const usePreviewPerformanceStore = create<PreviewPerformanceState>((set) => ({
	mode: readInitialMode(),
	setMode(mode) {
		if (typeof window !== "undefined") {
			try {
				window.localStorage.setItem(STORAGE_KEY, mode);
			} catch {
				// Sandboxed renderers can deny storage; the in-memory preference still works.
			}
		}
		set({ mode });
	},
}));

export function getPreviewPerformancePolicy(
	mode: PreviewPerformanceMode,
): PreviewPerformancePolicy {
	return POLICIES[mode];
}

export function usePreviewPerformancePolicy(): PreviewPerformancePolicy {
	const mode = usePreviewPerformanceStore((state) => state.mode);
	return POLICIES[mode];
}
