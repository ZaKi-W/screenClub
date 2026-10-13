import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { I18nProvider } from "./contexts/I18nContext";
import "./hooks/rendererConsoleForwarder";
import "./index.css";

const windowType = new URLSearchParams(window.location.search).get("windowType") || "";

// Reclaim multi-GB OPFS source copies left behind by a previous session (they
// are only pruned opportunistically during the next large-file load otherwise).
// Nothing is referenced at startup, so everything stale is safe to remove.
if (!windowType) {
	window.setTimeout(() => {
		void import("./lib/exporter/localSourceFile").then(({ clearStaleSourceCache }) =>
			clearStaleSourceCache().catch(() => undefined),
		);
	}, 5_000);
}
const showNotes = new URLSearchParams(window.location.search).get("showNotes") === "true";
if (
	showNotes ||
	windowType === "hud-overlay" ||
	windowType === "camera-overlay" ||
	windowType === "source-selector" ||
	windowType === "countdown-overlay"
) {
	document.body.style.background = "transparent";
	document.documentElement.style.background = "transparent";
	document.getElementById("root")?.style.setProperty("background", "transparent");
}

async function bootstrapRenderer() {
	// Browser-only preview support brings the full in-memory project shim and schema
	// migrations. Electron's preload is present before this script executes, so desktop
	// windows can keep that graph out of their startup bundle entirely.
	if (!window.electronAPI) {
		const { installBrowserShims } = await import("./native/browserShim");
		installBrowserShims();
	}

	const app = (
		<I18nProvider>
			<App />
		</I18nProvider>
	);
	ReactDOM.createRoot(document.getElementById("root")!).render(
		// StrictMode deliberately double-mounts effects in development. Keep that
		// diagnostic behaviour for browser work, but do not make Electron's media,
		// waveform and editor effects initialize twice on every local studio launch.
		import.meta.env.DEV && !window.electronAPI ? <React.StrictMode>{app}</React.StrictMode> : app,
	);
}

void bootstrapRenderer();
