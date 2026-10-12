import { create } from "zustand";

export type PreviewPerformanceMode = "quality" | "performance" | "power-saving";

export interface PreviewPerformancePolicy {
	mode: PreviewPerformanceMode;
	/** Maximum cadence for outer React/Zustand playhead updates. Visual presentation is separate. */
	uiFps: number;
	/**
	 * The native compositor currently returns full RGBA frames over Electron IPC. Keep it out of
	 * interactive preview modes so Chromium can present the hardware-decoded `<video>` directly.
	 */
	useNativeCompositor: boolean;
	/** Expensive preview-only decoration; export quality is unaffected. */
	visualQuality: "full" | "reduced";
}

const STORAGE_KEY = "openscreen.preview-performance-mode";

const POLICIES: Record<PreviewPerformanceMode, PreviewPerformancePolicy> = {
	quality: {
		mode: "quality",
		uiFps: 60,
		useNativeCompositor: false,
		visualQuality: "full",
	},
	performance: {
		mode: "performance",
		// Preserve interaction cadence. Performance mode sheds visual effects rather than making
		// the playhead/camera motion visibly step, matching Screen Studio's preview semantics.
		uiFps: 60,
		useNativeCompositor: false,
		visualQuality: "reduced",
	},
	"power-saving": {
		mode: "power-saving",
		// This is the only mode allowed to trade presentation cadence for energy use.
		uiFps: 30,
		useNativeCompositor: false,
		visualQuality: "reduced",
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
