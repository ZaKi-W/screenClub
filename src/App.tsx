import { lazy, Suspense, useEffect, useState } from "react";
import "./styles/fonts.css";
import "./styles/design-tokens.css";

import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { useScopedT } from "./contexts/I18nContext";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";

const AreaSelector = lazy(() =>
	import("./components/launch/AreaSelector.tsx").then((module) => ({
		default: module.AreaSelector,
	})),
);
const CountdownOverlay = lazy(() =>
	import("./components/launch/CountdownOverlay.tsx").then((module) => ({
		default: module.CountdownOverlay,
	})),
);
const CameraOverlay = lazy(() =>
	import("./components/launch/CameraOverlay.tsx").then((module) => ({
		default: module.CameraOverlay,
	})),
);
const LaunchWindow = lazy(() =>
	import("./components/launch/LaunchWindow").then((module) => ({
		default: module.LaunchWindow,
	})),
);
const NotesWindow = lazy(() =>
	import("./components/launch/NotesWindow.tsx").then((module) => ({
		default: module.NotesWindow,
	})),
);
const SourceSelector = lazy(() =>
	import("./components/launch/SourceSelector").then((module) => ({
		default: module.SourceSelector,
	})),
);

const VideoEditorEntry = lazy(() =>
	import("./components/ai-edition/AiEditionShell").then((module) => ({
		default: module.default,
	})),
);
const CliExportRunner = lazy(() => import("./cli/CliExportRunner"));
const CliRecordRunner = lazy(() => import("./cli/CliRecordRunner"));
const CliSourcesRunner = lazy(() => import("./cli/CliSourcesRunner"));
const CliCaptionsRunner = lazy(() => import("./cli/CliCaptionsRunner"));
const ShortcutsConfigDialog = lazy(() =>
	import("./components/video-editor/ShortcutsConfigDialog").then((module) => ({
		default: module.ShortcutsConfigDialog,
	})),
);

export default function App() {
	const [windowType, setWindowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "",
	);
	const showNotes = new URLSearchParams(window.location.search).get("showNotes") === "true";

	const tEditor = useScopedT("editor");

	useEffect(() => {
		const type = new URLSearchParams(window.location.search).get("windowType") || "";
		if (type !== windowType) {
			setWindowType(type);
		}

		if (
			type === "hud-overlay" ||
			type === "camera-overlay" ||
			type === "source-selector" ||
			type === "countdown-overlay" ||
			type === "area-selector"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		// HUD is a fixed-size BrowserWindow; pin the document shell and hide overflow
		// so the renderer can't introduce scrollbars (see issue #305).
		if (type === "hud-overlay" || type === "camera-overlay") {
			document.documentElement.style.height = "100%";
			document.documentElement.style.overflow = "hidden";
			document.body.style.height = "100%";
			document.body.style.margin = "0";
			document.body.style.overflow = "hidden";
			const root = document.getElementById("root");
			root?.style.setProperty("height", "100%");
			root?.style.setProperty("min-height", "0");
			root?.style.setProperty("overflow", "hidden");
		}
	}, [windowType]);

	useEffect(() => {
		// Custom fonts are only consumed by editor/export rendering. Importing the
		// manager in every renderer also made HUD/source-picker startup perform
		// localStorage reads and potentially issue Google Fonts requests.
		if (windowType !== "editor" && windowType !== "cli-export") return;
		void import("./lib/customFonts").then(({ loadAllCustomFonts }) =>
			loadAllCustomFonts().catch((error) => {
				console.error("Failed to load custom fonts:", error);
			}),
		);
	}, [windowType]);

	const content = (() => {
		switch (windowType) {
			case "hud-overlay":
				return <LaunchWindow />;
			case "source-selector":
				return <SourceSelector />;
			case "countdown-overlay":
				return <CountdownOverlay />;
			case "camera-overlay":
				return <CameraOverlay />;
			case "area-selector":
				return <AreaSelector />;
			case "cli-export":
				return (
					<Suspense fallback={null}>
						<CliExportRunner />
					</Suspense>
				);
			case "cli-record":
				return (
					<Suspense fallback={null}>
						<CliRecordRunner />
					</Suspense>
				);
			case "cli-sources":
				return (
					<Suspense fallback={null}>
						<CliSourcesRunner />
					</Suspense>
				);
			case "cli-captions":
				return (
					<Suspense fallback={null}>
						<CliCaptionsRunner />
					</Suspense>
				);
			case "editor":
				return (
					<ShortcutsProvider>
						<Suspense
							fallback={
								<div className="flex flex-col items-center justify-center gap-3 h-screen bg-[#09090b]">
									<svg
										className="animate-spin text-[#34B27B]"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										width={28}
										height={28}
									>
										<circle
											className="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											strokeWidth="4"
										/>
										<path
											className="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
										/>
									</svg>
									<span className="text-white/50 text-sm">{tEditor("loadingEditor")}</span>
								</div>
							}
						>
							<VideoEditorEntry />
							<ShortcutsConfigDialog />
						</Suspense>
					</ShortcutsProvider>
				);
			default:
				return (
					<div>
						<div className="w-full h-full bg-background text-foreground">
							<h1>Openscreen</h1>
						</div>
					</div>
				);
		}
	})();

	return (
		<TooltipProvider>
			<Suspense fallback={null}>{showNotes ? <NotesWindow /> : content}</Suspense>
			<Toaster theme="dark" />
		</TooltipProvider>
	);
}
