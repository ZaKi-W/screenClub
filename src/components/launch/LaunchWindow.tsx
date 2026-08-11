import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import { loadUserPreferences, saveUserPreferences } from "@/lib/userPreferences";
import { nativeBridgeClient } from "@/native";
import { type CameraDevice, useCameraDevices } from "../../hooks/useCameraDevices";
import { type MicrophoneDevice, useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { usePortalOwnsSource } from "../../hooks/usePortalOwnsSource";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { requestCameraAccess } from "../../lib/requestCameraAccess";
import {
	HudCaptureModeButton,
	HudCollapsedRecordingButton,
	HudDismissButton,
	HudDivider,
	HudNotice,
	HudSettingsButton,
	HudStatusToggleButton,
} from "./HudControls";
import {
	computeHudBarMaxHeight,
	HUD_BAR_BOTTOM,
	HUD_COLLAPSED_WINDOW_HEIGHT,
	HUD_COLLAPSED_WINDOW_WIDTH,
	HUD_COMPACT_EDGE_SLACK,
	HUD_POPOVER_GAP,
	HUD_STACK_GAP,
} from "./hudGeometry";
import styles from "./LaunchWindow.module.css";
import { openSourceSelectorWithPermissionRetry } from "./openSourceSelectorFlow";

// Locale list is computed once at module load; keeping the reference stable lets
// the language menu sit behind a memo boundary.
const AVAILABLE_LOCALES = getAvailableLocales();

// Used only when the renderer can't see a real display (tests, headless).
const FALLBACK_SCREEN_HEIGHT = 1080;

/**
 * Work-area height of the display, which is what the HUD's vertical budget is
 * really bounded by. Deliberately NOT `window.innerHeight`: the overlay window's
 * own height is the value this measurement feeds back into, and reading it here
 * is exactly what used to close the resize feedback loop.
 */
function getAvailableScreenHeight(): number {
	const available = typeof window === "undefined" ? 0 : window.screen?.availHeight;
	return available && available > 0 ? available : FALLBACK_SCREEN_HEIGHT;
}

/** Launches the floating recording HUD and its recorder controls. */
export function LaunchWindow() {
	const t = useScopedT("launch");
	const commonT = useScopedT("common");
	const {
		locale,
		setLocale,
		systemLocaleSuggestion,
		acceptSystemLocaleSuggestion,
		dismissSystemLocaleSuggestion,
		resolveSystemLocaleSuggestion,
	} = useI18n();
	const suggestedLanguageName = systemLocaleSuggestion ? getLocaleName(systemLocaleSuggestion) : "";

	const {
		recording,
		paused,
		saving,
		elapsedSeconds,
		toggleRecording,
		togglePaused,
		canPauseRecording,
		restartRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		setMicrophoneDeviceName,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		setWebcamDeviceName,
		cursorCaptureMode,
		setCursorCaptureMode,
		captureArea,
		setCaptureArea,
		softwareEncoderFallbackNoticeVisible,
		dismissSoftwareEncoderFallbackNotice,
	} = useScreenRecorder();

	const [pendingNativeInputMenu, setPendingNativeInputMenu] = useState<
		"camera" | "microphone" | "system-audio" | null
	>(null);
	const [isNativeSettingsMenuOpen, setIsNativeSettingsMenuOpen] = useState(false);
	const [trayLayout, setTrayLayout] = useState<"horizontal" | "vertical">(
		() => loadUserPreferences().trayLayout,
	);
	const [isRecordingHudCollapsed, setIsRecordingHudCollapsed] = useState(false);
	const [supportsCursorModeToggle, setSupportsCursorModeToggle] = useState(false);
	const [isLinuxHud, setIsLinuxHud] = useState(false);
	const [isMacHud, setIsMacHud] = useState(false);
	/**
	 * Narrower than [`isLinuxHud`] on purpose: without the helper the recorder
	 * falls back to Chromium's capture, which DOES take a source id, so the
	 * in-app picker has to stay for that case.
	 */
	const portalOwnsSource = usePortalOwnsSource();

	const isVertical = trayLayout === "vertical";
	const controlsLocked = recording || saving;

	const hudAnchorRef = useRef<HTMLDivElement | null>(null);
	const hudBarRef = useRef<HTMLDivElement | null>(null);
	const hudNoticesRef = useRef<HTMLDivElement | null>(null);

	// The camera list is enumerated from mount rather than on first open. It costs
	// one enumerateDevices() call and means the picker renders its final content
	// on its very first frame, and that `webcamDeviceId` is already the default
	// device when the button is clicked — so enabling the camera acquires the
	// right stream once instead of acquiring the default and then re-acquiring.
	const {
		devices: cameraDevices,
		selectedDeviceId: selectedCameraId,
		setSelectedDeviceId: setSelectedCameraId,
		isLoading: isCameraDevicesLoading,
	} = useCameraDevices(true);
	// The microphone list stays lazy: enumerating it asks for mic permission,
	// which would light the OS "in use" indicator just for opening the HUD.
	const {
		devices: micDevices,
		selectedDeviceId: selectedMicId,
		setSelectedDeviceId: setSelectedMicId,
		isLoading: isMicDevicesLoading,
	} = useMicrophoneDevices(microphoneEnabled || pendingNativeInputMenu === "microphone");

	useEffect(() => {
		if (selectedMicId && selectedMicId !== "default") {
			setMicrophoneDeviceId(selectedMicId);
			setMicrophoneDeviceName(micDevices.find((d) => d.deviceId === selectedMicId)?.label);
		}
	}, [selectedMicId, micDevices, setMicrophoneDeviceId, setMicrophoneDeviceName]);

	useEffect(() => {
		if (selectedCameraId) {
			setWebcamDeviceId(selectedCameraId);
			setWebcamDeviceName(cameraDevices.find((d) => d.deviceId === selectedCameraId)?.label);
		}
	}, [selectedCameraId, cameraDevices, setWebcamDeviceId, setWebcamDeviceName]);

	useEffect(() => {
		let cancelled = false;
		nativeBridgeClient.system
			.getPlatform()
			.then((platform) => {
				if (!cancelled) {
					// Every platform with a native capture helper that can honour the
					// choice, which is now all three. Windows passes `captureCursor`
					// to wgc-capture, macOS passes `hideSystemCursor` to the
					// ScreenCaptureKit helper, and Linux passes `cursorMode` to the
					// PipeWire helper, which asks the ScreenCast portal for METADATA
					// or EMBEDDED. All three genuinely omit the system cursor from
					// the pixels.
					//
					// Linux was excluded here until the helper existed, and the
					// reason is worth keeping: capture went through Chromium, and
					// Chromium offers NO way to suppress the cursor.
					// `DesktopCaptureDevice::Create` wraps every capturer in a
					// `DesktopAndCursorComposer` unconditionally; on Linux WebRTC
					// asks the portal for METADATA mode and then paints the cursor
					// back in itself. So the toggle would have switched the editor's
					// overlay on without changing the pixels — which is exactly how
					// you get two cursors. Verified against a real recording at the
					// time. The helper is what makes the control mean something,
					// because it owns the video and never asks WebRTC for anything.
					setSupportsCursorModeToggle(
						platform === "win32" || platform === "darwin" || platform === "linux",
					);
					setIsLinuxHud(platform === "linux");
					setIsMacHud(platform === "darwin");
				}
			})
			.catch(() => {
				if (!cancelled) {
					setSupportsCursorModeToggle(false);
					setIsLinuxHud(false);
					setIsMacHud(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!import.meta.env.DEV) {
			return;
		}

		void requestCameraAccess().catch((error) => {
			console.warn("Failed to trigger camera access request during development:", error);
		});
	}, []);

	// One dismiss handler for both floating surfaces — they're mutually exclusive,
	// so a single pointerdown/Escape listener covers the pair instead of two.
	const closePopovers = useCallback(() => {
		setPendingNativeInputMenu(null);
		setIsNativeSettingsMenuOpen(false);
	}, []);

	useEffect(() => {
		if (recording) {
			closePopovers();
			setIsRecordingHudCollapsed(true);
		} else {
			setIsRecordingHudCollapsed(false);
		}
	}, [closePopovers, recording]);

	// ---------------------------------------------------------------------------
	// Overlay window sizing
	//
	// The renderer owns the overlay window's size, so a naive "measure what's on
	// screen and grow to fit" is a feedback loop: the resize changes the viewport,
	// viewport-sized boxes re-layout, the observer fires again. That loop is what
	// made the HUD flicker and jump the first few times each popover was opened.
	//
	// Two rules break it, and both live here:
	//   1. Only the bar is measured. Everything floating above it has a fixed
	//      width and a capped height, so its space is *reserved* from the first
	//      frame — opening a popover costs zero native resizes.
	//   2. No measured box may be sized against the viewport. Caps come from
	//      screen.availHeight (which a window resize can't change) and are pushed
	//      down as CSS custom properties.
	// ---------------------------------------------------------------------------
	const hudAllocatedSizeRef = useRef({ width: 0, height: 0, orientation: trayLayout });
	const isDraggingHudRef = useRef(false);

	useLayoutEffect(() => {
		const anchor = hudAnchorRef.current;
		if (!anchor) return;
		anchor.style.setProperty("--hud-bar-bottom", `${HUD_BAR_BOTTOM}px`);
		anchor.style.setProperty("--hud-popover-gap", `${HUD_POPOVER_GAP}px`);
		anchor.style.setProperty("--hud-stack-gap", `${HUD_STACK_GAP}px`);
		anchor.style.setProperty(
			"--hud-bar-max-h",
			`${computeHudBarMaxHeight(getAvailableScreenHeight())}px`,
		);
	}, []);

	const measureHudSize = useCallback(() => {
		const barEl = hudBarRef.current;
		if (!barEl || !window.electronAPI?.setHudOverlaySize) return;
		if (isDraggingHudRef.current) return;
		if (isRecordingHudCollapsed) {
			const allocated = hudAllocatedSizeRef.current;
			if (
				allocated.width === HUD_COLLAPSED_WINDOW_WIDTH &&
				allocated.height === HUD_COLLAPSED_WINDOW_HEIGHT
			) {
				return;
			}
			allocated.width = HUD_COLLAPSED_WINDOW_WIDTH;
			allocated.height = HUD_COLLAPSED_WINDOW_HEIGHT;
			allocated.orientation = trayLayout;
			window.electronAPI.setHudOverlaySize(HUD_COLLAPSED_WINDOW_WIDTH, HUD_COLLAPSED_WINDOW_HEIGHT);
			return;
		}

		const barRect = barEl.getBoundingClientRect();
		const barWidth = barRect.width || barEl.scrollWidth;
		const barHeight = barRect.height || barEl.scrollHeight;
		if (barWidth <= 0 || barHeight <= 0) return;
		const noticeEl = hudNoticesRef.current;
		const noticeHeight = noticeEl
			? noticeEl.getBoundingClientRect().height || noticeEl.scrollHeight
			: 0;

		const noticeRect = noticeEl?.getBoundingClientRect();
		const noticeWidth = noticeEl ? noticeRect?.width || noticeEl.scrollWidth : 0;
		const width =
			Math.max(Math.ceil(barWidth), Math.ceil(noticeWidth)) + HUD_COMPACT_EDGE_SLACK * 2;
		const height =
			HUD_BAR_BOTTOM +
			Math.ceil(barHeight) +
			(noticeHeight > 0 ? HUD_POPOVER_GAP + Math.ceil(noticeHeight) : 0) +
			HUD_COMPACT_EDGE_SLACK;
		const allocated = hudAllocatedSizeRef.current;
		if (allocated.width === width && allocated.height === height) return;
		allocated.width = width;
		allocated.height = height;
		allocated.orientation = trayLayout;
		window.electronAPI.setHudOverlaySize(width, height);
	}, [isRecordingHudCollapsed, trayLayout]);

	// One persistent observer; elements wire themselves up via callback refs as
	// they mount/unmount. Only the bar and the notice column are observed — the
	// popovers deliberately are not, since their space is already reserved.
	const hudResizeObserverRef = useRef<ResizeObserver | null>(null);
	useEffect(() => {
		const observer = new ResizeObserver(() => measureHudSize());
		hudResizeObserverRef.current = observer;
		if (hudBarRef.current) observer.observe(hudBarRef.current);
		if (hudNoticesRef.current) observer.observe(hudNoticesRef.current);
		measureHudSize();
		return () => {
			observer.disconnect();
			hudResizeObserverRef.current = null;
		};
	}, [measureHudSize]);

	const observeHudElement = useCallback(
		<T extends HTMLElement>(el: T | null, ref: React.MutableRefObject<T | null>) => {
			const observer = hudResizeObserverRef.current;
			if (ref.current && observer) observer.unobserve(ref.current);
			ref.current = el;
			if (el && observer) observer.observe(el);
			measureHudSize();
		},
		[measureHudSize],
	);
	const setHudBarEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, hudBarRef),
		[observeHudElement],
	);
	const setHudNoticesEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, hudNoticesRef),
		[observeHudElement],
	);

	const hudIgnoreMouseEventsRef = useRef<boolean | undefined>(undefined);
	const setHudMouseEventsEnabled = useCallback(
		(enabled: boolean) => {
			const shouldIgnoreMouseEvents = !enabled && !isLinuxHud;
			if (hudIgnoreMouseEventsRef.current === shouldIgnoreMouseEvents) {
				return;
			}
			hudIgnoreMouseEventsRef.current = shouldIgnoreMouseEvents;
			window.electronAPI?.setHudOverlayIgnoreMouseEvents?.(shouldIgnoreMouseEvents);
		},
		[isLinuxHud],
	);

	useEffect(() => {
		setHudMouseEventsEnabled(false);
		return () => {
			window.electronAPI?.setHudOverlayIgnoreMouseEvents?.(false);
		};
	}, [setHudMouseEventsEnabled]);

	const [selectedSourceKind, setSelectedSourceKind] = useState<"screen" | "window" | "area" | null>(
		null,
	);
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const recordAfterSourceSelectionRef = useRef(false);
	const captureAreaRef = useRef(captureArea);
	captureAreaRef.current = captureArea;

	const applySelectedSource = useCallback((source: ProcessedDesktopSource | null) => {
		if (source) {
			const displayId = Number(source.display_id);
			setSelectedSourceKind(
				source.id.startsWith("window:")
					? "window"
					: captureAreaRef.current?.displayId === displayId
						? "area"
						: "screen",
			);
			setHasSelectedSource(true);
			return;
		}

		setSelectedSourceKind(null);
		setHasSelectedSource(false);
	}, []);

	// The main process pushes every change through `onSelectedSourceChanged`, so
	// this only needs one read to seed the initial value (plus one on focus, in
	// case a change was missed while this window was gone). The old 500ms poll ran
	// two IPC round-trips a second, forever, for a value that is event-driven.
	useEffect(() => {
		let cancelled = false;

		const refreshSelectedSource = async () => {
			if (!window.electronAPI) {
				return;
			}

			try {
				const source = await window.electronAPI.getSelectedSource();
				if (!cancelled) {
					applySelectedSource(source);
				}
			} catch (error) {
				console.warn("Failed to refresh selected source:", error);
			}
		};

		void refreshSelectedSource();
		window.addEventListener("focus", refreshSelectedSource);

		return () => {
			cancelled = true;
			window.removeEventListener("focus", refreshSelectedSource);
		};
	}, [applySelectedSource]);

	useEffect(() => {
		const cleanupSourceChanged = window.electronAPI?.onSelectedSourceChanged?.((source) => {
			applySelectedSource(source);
			if (!recordAfterSourceSelectionRef.current || recording) {
				return;
			}

			recordAfterSourceSelectionRef.current = false;
			toggleRecording();
		});
		const cleanupSelectorClosed = window.electronAPI?.onSourceSelectorClosed?.(() => {
			recordAfterSourceSelectionRef.current = false;
		});

		return () => {
			cleanupSourceChanged?.();
			cleanupSelectorClosed?.();
		};
	}, [applySelectedSource, recording, toggleRecording]);

	const openSourceSelector = useCallback(async (preferredKind?: "screen" | "window") => {
		if (window.electronAPI) {
			return await openSourceSelectorWithPermissionRetry({
				openSourceSelector: () => window.electronAPI.openSourceSelector(preferredKind),
				requestScreenAccess: () => window.electronAPI.requestScreenAccess(),
			});
		}

		return { opened: false, reason: "electron-api-unavailable" };
	}, []);
	const openSourceSelectorAndStart = useCallback(
		async (preferredKind: "screen" | "window") => {
			recordAfterSourceSelectionRef.current = true;
			try {
				const result = await openSourceSelector(preferredKind);
				if (result.opened) return;
				recordAfterSourceSelectionRef.current = false;
				if (result.reason === "portal-owns-selection" && !recording) {
					toggleRecording();
				}
			} catch (error) {
				recordAfterSourceSelectionRef.current = false;
				console.warn("Failed to open the source selector:", error);
			}
		},
		[openSourceSelector, recording, toggleRecording],
	);
	const openScreenSourceSelector = useCallback(() => {
		captureAreaRef.current = null;
		setCaptureArea(null);
		setSelectedSourceKind((kind) => (kind === "area" ? "screen" : kind));
		void openSourceSelectorAndStart("screen");
	}, [openSourceSelectorAndStart, setCaptureArea]);
	const openWindowSourceSelector = useCallback(() => {
		captureAreaRef.current = null;
		setCaptureArea(null);
		setSelectedSourceKind((kind) => (kind === "area" ? "screen" : kind));
		void openSourceSelectorAndStart("window");
	}, [openSourceSelectorAndStart, setCaptureArea]);
	const openAreaSelector = useCallback(async () => {
		if (controlsLocked || !isMacHud) return;
		closePopovers();
		try {
			const access = await window.electronAPI.requestScreenAccess();
			if (!access.granted) {
				console.warn("Screen Recording permission is required to select an area.");
				return;
			}
			const selection = await window.electronAPI.openAreaSelector();
			if (!selection) return;
			const sources = await window.electronAPI.getSources({
				types: ["screen"],
				thumbnailSize: { width: 1, height: 1 },
			});
			const source = sources.find(
				(candidate) => Number(candidate.display_id) === selection.displayId,
			);
			if (!source) {
				console.warn("Area selection display is no longer available.");
				return;
			}
			captureAreaRef.current = selection;
			setCaptureArea(selection);
			recordAfterSourceSelectionRef.current = true;
			await window.electronAPI.selectSource(source);
			if (recordAfterSourceSelectionRef.current) {
				recordAfterSourceSelectionRef.current = false;
				toggleRecording();
			}
			applySelectedSource(source);
			setSelectedSourceKind("area");
		} catch (error) {
			console.warn("Failed to select a recording area:", error);
		}
	}, [
		applySelectedSource,
		closePopovers,
		controlsLocked,
		isMacHud,
		setCaptureArea,
		toggleRecording,
	]);

	const handleRecordButtonClick = useCallback(
		(sourceSelectedOverride?: boolean) => {
			if (saving) {
				return;
			}
			// Linux never detours through the in-app picker: there is nothing for
			// it to select, and waiting for a selection that can never arrive left
			// the record button opening a modal instead of recording.
			const sourceSelected = portalOwnsSource || (sourceSelectedOverride ?? hasSelectedSource);
			if (!sourceSelected && !recording) {
				recordAfterSourceSelectionRef.current = true;
				void openSourceSelector()
					.then((result) => {
						if (result.opened) {
							return;
						}
						recordAfterSourceSelectionRef.current = false;
						// The main process is the authority on who owns the choice,
						// and it answers synchronously. `portalOwnsSource` is resolved
						// over IPC, so for a moment after mount it still reads false —
						// and a Record click landing in that window used to open a
						// selector that refused, leaving the click doing nothing at
						// all. Honouring the refusal starts the recording instead,
						// whatever the local state has caught up to.
						if (result.reason === "portal-owns-selection" && !recording) {
							toggleRecording();
						}
					})
					.catch(() => {
						recordAfterSourceSelectionRef.current = false;
					});
				return;
			}

			toggleRecording();
		},
		[hasSelectedSource, portalOwnsSource, openSourceSelector, recording, saving, toggleRecording],
	);
	const handleRecordClick = useCallback(() => handleRecordButtonClick(), [handleRecordButtonClick]);

	// The editor's Rec-mode stage sends this once it hands off to the HUD
	// (source + prefs already persisted via IPC), so the user doesn't have to
	// click Record a second time after "Start recording" reopens this window.
	// The auto-start signal can arrive before this window's own initial
	// `getSelectedSource` round-trip has resolved, so `hasSelectedSource` may
	// still be stale — fetch a fresh value here instead of trusting it, otherwise
	// auto-start can wrongly fall through to opening the source selector.
	const handleRecordButtonClickRef = useRef(handleRecordButtonClick);
	handleRecordButtonClickRef.current = handleRecordButtonClick;
	const hasSelectedSourceRef = useRef(hasSelectedSource);
	hasSelectedSourceRef.current = hasSelectedSource;
	useEffect(() => {
		return window.electronAPI?.onAutoStartRecording?.(() => {
			void (async () => {
				let sourceSelected = hasSelectedSourceRef.current;
				try {
					const source = await window.electronAPI?.getSelectedSource?.();
					sourceSelected = !!source;
					applySelectedSource(source ?? null);
				} catch (error) {
					console.warn("Failed to refresh selected source before auto-start:", error);
				}
				handleRecordButtonClickRef.current(sourceSelected);
			})();
		});
	}, [applySelectedSource]);

	const sendHudOverlayHide = useCallback(() => {
		window.electronAPI?.hudOverlayHide?.();
	}, []);
	const openStudio = useCallback(() => {
		if (!saving) window.electronAPI.switchToEditor();
	}, [saving]);
	const openNotes = useCallback(() => {
		if (!saving) window.electronAPI.openNotes();
	}, [saving]);

	const setTrayLayoutPreference = useCallback((layout: "horizontal" | "vertical") => {
		saveUserPreferences({ trayLayout: layout });
		setTrayLayout(layout);
	}, []);

	// Selecting a device never switches it on. If the device is already live the
	// recorder re-acquires on the id change; if it isn't, this just records which
	// one the next toggle should use.
	const handleSelectMicDevice = useCallback(
		(device: MicrophoneDevice) => {
			setSelectedMicId(device.deviceId);
			setMicrophoneDeviceId(device.deviceId);
			setMicrophoneDeviceName(device.label);
		},
		[setMicrophoneDeviceId, setMicrophoneDeviceName, setSelectedMicId],
	);

	const handleSelectCameraDevice = useCallback(
		(device: CameraDevice) => {
			setSelectedCameraId(device.deviceId);
			setWebcamDeviceId(device.deviceId);
			setWebcamDeviceName(device.label);
		},
		[setSelectedCameraId, setWebcamDeviceId, setWebcamDeviceName],
	);

	const handleChooseMicDevice = useCallback(
		(deviceId: string) => {
			const device = micDevices.find((candidate) => candidate.deviceId === deviceId);
			if (!device) return;
			handleSelectMicDevice(device);
			setMicrophoneEnabled(true);
		},
		[handleSelectMicDevice, micDevices, setMicrophoneEnabled],
	);

	const handleChooseCameraDevice = useCallback(
		(deviceId: string) => {
			const device = cameraDevices.find((candidate) => candidate.deviceId === deviceId);
			if (!device) return;
			handleSelectCameraDevice(device);
			void setWebcamEnabled(true);
		},
		[cameraDevices, handleSelectCameraDevice, setWebcamEnabled],
	);

	const openCameraNativeMenu = useCallback(async () => {
		if (controlsLocked) return;
		closePopovers();
		setPendingNativeInputMenu("camera");
		try {
			const result = await window.electronAPI.showHudNativeInputMenu({
				kind: "camera",
				items: cameraDevices.map((device) => ({ id: device.deviceId, label: device.label })),
				activeId: webcamDeviceId || selectedCameraId,
				enabled: webcamEnabled,
				enableLabel: t("webcam.enableWebcam"),
				disableLabel: t("webcam.disableWebcam"),
				emptyLabel: isCameraDevicesLoading ? t("webcam.searching") : t("webcam.noneFound"),
			});
			if (result?.action === "select") handleChooseCameraDevice(result.id);
			if (result?.action === "disable") void setWebcamEnabled(false);
		} catch (error) {
			console.warn("Failed to open the native camera menu:", error);
		} finally {
			setPendingNativeInputMenu(null);
		}
	}, [
		cameraDevices,
		closePopovers,
		controlsLocked,
		handleChooseCameraDevice,
		isCameraDevicesLoading,
		selectedCameraId,
		setWebcamEnabled,
		t,
		webcamDeviceId,
		webcamEnabled,
	]);

	const micMenuSawLoadingRef = useRef(false);
	const micNativeMenuOpenRef = useRef(false);
	const openMicrophoneNativeMenu = useCallback(() => {
		if (controlsLocked) return;
		closePopovers();
		micMenuSawLoadingRef.current = false;
		setPendingNativeInputMenu("microphone");
	}, [closePopovers, controlsLocked]);

	useEffect(() => {
		if (pendingNativeInputMenu !== "microphone") return;
		if (isMicDevicesLoading) {
			micMenuSawLoadingRef.current = true;
			return;
		}
		// On first open the device hook has not run yet. Wait for its loading cycle
		// instead of flashing a native "no microphone" menu before permission and
		// enumeration have even started. Existing devices can be shown immediately.
		if (!micMenuSawLoadingRef.current && micDevices.length === 0) return;
		if (micNativeMenuOpenRef.current) return;

		micNativeMenuOpenRef.current = true;
		void window.electronAPI
			.showHudNativeInputMenu({
				kind: "microphone",
				items: micDevices.map((device) => ({ id: device.deviceId, label: device.label })),
				activeId: microphoneDeviceId || selectedMicId,
				enabled: microphoneEnabled,
				enableLabel: t("audio.enableMicrophone"),
				disableLabel: t("audio.disableMicrophone"),
				emptyLabel: t("deviceSettings.noMicrophones"),
			})
			.then((result) => {
				if (result?.action === "select") handleChooseMicDevice(result.id);
				if (result?.action === "disable") setMicrophoneEnabled(false);
			})
			.catch((error) => {
				console.warn("Failed to open the native microphone menu:", error);
			})
			.finally(() => {
				micNativeMenuOpenRef.current = false;
				setPendingNativeInputMenu(null);
			});
	}, [
		handleChooseMicDevice,
		isMicDevicesLoading,
		micDevices,
		microphoneDeviceId,
		microphoneEnabled,
		pendingNativeInputMenu,
		selectedMicId,
		setMicrophoneEnabled,
		t,
	]);

	const openSystemAudioNativeMenu = useCallback(async () => {
		if (controlsLocked) return;
		closePopovers();
		setPendingNativeInputMenu("system-audio");
		try {
			const result = await window.electronAPI.showHudNativeInputMenu({
				kind: "system-audio",
				items: [],
				enabled: systemAudioEnabled,
				enableLabel: t("audio.enableSystemAudio"),
				disableLabel: t("audio.disableSystemAudio"),
				emptyLabel: "",
			});
			if (result?.action === "enable") setSystemAudioEnabled(true);
			if (result?.action === "disable") setSystemAudioEnabled(false);
		} catch (error) {
			console.warn("Failed to open the native system-audio menu:", error);
		} finally {
			setPendingNativeInputMenu(null);
		}
	}, [closePopovers, controlsLocked, setSystemAudioEnabled, systemAudioEnabled, t]);

	const openNativeSettingsMenu = useCallback(async () => {
		if (controlsLocked) return;
		setPendingNativeInputMenu(null);
		setIsNativeSettingsMenuOpen(true);
		try {
			const result = await window.electronAPI.showHudNativeSettingsMenu({
				showNotes: !isLinuxHud,
				showCursorMode: supportsCursorModeToggle,
				editableCursor: cursorCaptureMode === "editable-overlay",
				verticalLayout: isVertical,
				countdownSeconds: loadUserPreferences().recordingCountdownSeconds,
				activeLocale: locale,
				locales: AVAILABLE_LOCALES.map((id) => ({ id, label: getLocaleName(id) })),
				labels: {
					notes: t("tooltips.openNotes"),
					countdown: t("nativeMenu.recordingCountdown"),
					countdownThreeSeconds: t("nativeMenu.threeSeconds"),
					countdownFiveSeconds: t("nativeMenu.fiveSeconds"),
					countdownTenSeconds: t("nativeMenu.tenSeconds"),
					advanced: t("nativeMenu.advanced"),
					editableCursor: t("cursor.useEditableCursor"),
					systemCursor: t("cursor.useSystemCursor"),
					horizontalLayout: t("tooltips.useHorizontalTray"),
					verticalLayout: t("tooltips.useVerticalTray"),
					language: t("language"),
					openStudio: t("tooltips.openStudio"),
				},
			});
			if (result?.action === "notes") openNotes();
			if (result?.action === "studio") openStudio();
			if (result?.action === "cursor") setCursorCaptureMode(result.mode);
			if (result?.action === "layout") setTrayLayoutPreference(result.layout);
			if (result?.action === "countdown") {
				saveUserPreferences({ recordingCountdownSeconds: result.seconds });
			}
			if (result?.action === "locale") {
				setLocale(result.locale as Parameters<typeof setLocale>[0]);
				resolveSystemLocaleSuggestion();
			}
		} catch (error) {
			console.warn("Failed to open the native HUD settings menu:", error);
		} finally {
			setIsNativeSettingsMenuOpen(false);
		}
	}, [
		controlsLocked,
		cursorCaptureMode,
		isLinuxHud,
		isVertical,
		locale,
		openNotes,
		openStudio,
		resolveSystemLocaleSuggestion,
		setCursorCaptureMode,
		setLocale,
		setTrayLayoutPreference,
		supportsCursorModeToggle,
		t,
	]);

	const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
	const lastDragDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

	const handleHudDragPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			setHudMouseEventsEnabled(true);
			event.currentTarget.setPointerCapture(event.pointerId);
			dragOriginRef.current = { x: event.screenX, y: event.screenY };
			lastDragDeltaRef.current = { x: 0, y: 0 };
			isDraggingHudRef.current = true;
			window.electronAPI?.beginHudOverlayDrag?.();
		},
		[setHudMouseEventsEnabled],
	);

	const handleHudDragPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const origin = dragOriginRef.current;
		if (!origin) return;
		const deltaX = event.screenX - origin.x;
		const deltaY = event.screenY - origin.y;
		const last = lastDragDeltaRef.current;
		if (last.x === deltaX && last.y === deltaY) return;
		lastDragDeltaRef.current = { x: deltaX, y: deltaY };
		window.electronAPI?.dragHudOverlayTo?.(deltaX, deltaY);
	}, []);

	const handleHudDragPointerEnd = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!dragOriginRef.current) return;
			dragOriginRef.current = null;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			isDraggingHudRef.current = false;
			window.electronAPI?.endHudOverlayDrag?.();
			measureHudSize();
		},
		[measureHudSize],
	);

	const enableHudMouseEvents = useCallback(() => {
		setHudMouseEventsEnabled(true);
	}, [setHudMouseEventsEnabled]);

	const handleHudBarPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const target = event.target as Element | null;
			if (
				event.button !== 0 ||
				target?.closest("button, [role='menu'], [role='dialog'], [data-hud-popover-trigger='true']")
			) {
				enableHudMouseEvents();
				return;
			}
			handleHudDragPointerDown(event);
		},
		[enableHudMouseEvents, handleHudDragPointerDown],
	);

	const handleRootPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (isDraggingHudRef.current) return;
			const target = event.target as HTMLElement | null;
			setHudMouseEventsEnabled(Boolean(target?.closest("[data-hud-interactive='true']")));
		},
		[setHudMouseEventsEnabled],
	);

	const handlePointerLeave = useCallback(() => {
		setHudMouseEventsEnabled(false);
	}, [setHudMouseEventsEnabled]);

	const dismissSoftwareFallbackForever = useCallback(() => {
		dismissSoftwareEncoderFallbackNotice(true);
	}, [dismissSoftwareEncoderFallbackNotice]);
	const dismissSoftwareFallbackOnce = useCallback(() => {
		dismissSoftwareEncoderFallbackNotice();
	}, [dismissSoftwareEncoderFallbackNotice]);

	const hasNotices = Boolean(systemLocaleSuggestion) || softwareEncoderFallbackNoticeVisible;
	const cameraStatusLabel = webcamEnabled
		? cameraDevices.find((device) => device.deviceId === (webcamDeviceId || selectedCameraId))
				?.label || t("webcam.camera")
		: `${t("webcam.camera")} · ${t("audio.off")}`;
	const microphoneStatusLabel = microphoneEnabled
		? micDevices.find((device) => device.deviceId === (microphoneDeviceId || selectedMicId))
				?.label || t("audio.microphone")
		: `${t("audio.microphone")} · ${t("audio.off")}`;
	const systemAudioStatusLabel = `${t("audio.systemAudio")} · ${t(
		systemAudioEnabled ? "audio.on" : "audio.off",
	)}`;

	return (
		// Avoid w-screen/h-screen: 100vw can exceed the inner layout width when scrollbars
		// affect the viewport (Windows), causing a horizontal scrollbar (issue #305).
		<div
			// No `electronDrag` here. This root is the whole 820x560 window, nearly all of
			// it invisible, and a drag region is honoured by the compositor whether or not
			// anything is painted there. On Windows/macOS that stayed hidden because
			// `setIgnoreMouseEvents` makes the transparent area input-transparent at the OS
			// level; on Linux that call is a no-op, so pressing empty space next to the bar
			// dragged the HUD from a spot the user was aiming *past*. The drag surface is
			// therefore limited to the painted bar; controls opt out so clicks still work.
			className="h-full w-full min-w-0 max-w-full overflow-x-hidden overflow-y-hidden bg-transparent"
			onPointerMove={handleRootPointerMove}
			onPointerLeave={handlePointerLeave}
		>
			{/* One bottom-anchored stack: the bar, then whatever floats above it.
			    Everything is laid out by flexbox relative to the bar, so no popover
			    needs a measured position and none of them can move the window. */}
			<div ref={hudAnchorRef} className={styles.hudAnchor}>
				<div
					ref={setHudBarEl}
					data-testid="hud-drag-handle"
					data-hud-interactive="true"
					data-tray-layout={trayLayout}
					data-hud-collapsed={isRecordingHudCollapsed}
					className={`${styles.hudBar} ${isLinuxHud ? styles.electronDrag : styles.electronNoDrag} ${
						isRecordingHudCollapsed
							? styles.hudBarCollapsed
							: isVertical
								? styles.hudBarVertical
								: styles.hudBarHorizontal
					}`}
					onPointerEnter={enableHudMouseEvents}
					onPointerDown={handleHudBarPointerDown}
					onPointerMove={handleHudDragPointerMove}
					onPointerUp={handleHudDragPointerEnd}
					onPointerCancel={handleHudDragPointerEnd}
					onMouseEnter={enableHudMouseEvents}
					onMouseLeave={handlePointerLeave}
				>
					{isRecordingHudCollapsed ? (
						<HudCollapsedRecordingButton
							saving={saving}
							paused={paused}
							canPause={canPauseRecording}
							elapsedSeconds={elapsedSeconds}
							label={commonT("actions.stopRecording")}
							pauseLabel={paused ? t("tooltips.resumeRecording") : t("tooltips.pauseRecording")}
							restartLabel={t("tooltips.restartRecording")}
							cancelLabel={t("tooltips.cancelRecording")}
							onStop={handleRecordClick}
							onTogglePause={togglePaused}
							onRestart={restartRecording}
							onCancel={cancelRecording}
						/>
					) : (
						<>
							<HudDismissButton
								label={t("tooltips.hideHUD")}
								disabled={saving}
								onClick={sendHudOverlayHide}
							/>

							<HudDivider vertical={isVertical} />

							{!portalOwnsSource && (
								<div className={`flex items-center gap-1 ${isVertical ? "flex-col" : ""}`}>
									<HudCaptureModeButton
										kind="screen"
										label={commonT("recordingSource.screen")}
										active={selectedSourceKind === "screen"}
										disabled={controlsLocked}
										compact={isVertical}
										onClick={openScreenSourceSelector}
									/>
									<HudCaptureModeButton
										kind="window"
										label={commonT("recordingSource.window")}
										active={selectedSourceKind === "window"}
										disabled={controlsLocked}
										compact={isVertical}
										onClick={openWindowSourceSelector}
									/>
									{isMacHud && (
										<HudCaptureModeButton
											kind="area"
											label={commonT("recordingSource.area")}
											active={selectedSourceKind === "area"}
											disabled={controlsLocked}
											compact={isVertical}
											onClick={openAreaSelector}
										/>
									)}
								</div>
							)}
							{portalOwnsSource && (
								<HudCaptureModeButton
									kind="screen"
									label={t("recording.systemPicker")}
									active={false}
									disabled={controlsLocked}
									compact={isVertical}
									onClick={handleRecordClick}
								/>
							)}

							<HudDivider vertical={isVertical} />

							<div className={`flex items-center gap-1 ${isVertical ? "flex-col" : ""}`}>
								<HudStatusToggleButton
									kind="camera"
									enabled={webcamEnabled}
									disabled={controlsLocked}
									label={webcamEnabled ? t("webcam.disableWebcam") : t("webcam.enableWebcam")}
									statusLabel={cameraStatusLabel}
									compact={isVertical}
									expanded={pendingNativeInputMenu === "camera"}
									onClick={openCameraNativeMenu}
								/>
								<HudStatusToggleButton
									kind="microphone"
									enabled={microphoneEnabled}
									disabled={controlsLocked}
									label={
										microphoneEnabled ? t("audio.disableMicrophone") : t("audio.enableMicrophone")
									}
									statusLabel={microphoneStatusLabel}
									compact={isVertical}
									expanded={pendingNativeInputMenu === "microphone"}
									onClick={openMicrophoneNativeMenu}
								/>
								<HudStatusToggleButton
									kind="system-audio"
									enabled={systemAudioEnabled}
									disabled={controlsLocked}
									label={
										systemAudioEnabled
											? t("audio.disableSystemAudio")
											: t("audio.enableSystemAudio")
									}
									statusLabel={systemAudioStatusLabel}
									compact={isVertical}
									expanded={pendingNativeInputMenu === "system-audio"}
									onClick={openSystemAudioNativeMenu}
								/>
							</div>

							<HudDivider vertical={isVertical} />

							<HudSettingsButton
								disabled={controlsLocked}
								expanded={isNativeSettingsMenuOpen}
								label={t("deviceSettings.title")}
								onClick={openNativeSettingsMenu}
							/>
						</>
					)}
				</div>

				{!recording && hasNotices && (
					// column-reverse: first child sits closest to the bar.
					<div className={styles.hudAbove}>
						{hasNotices && (
							<div
								ref={setHudNoticesEl}
								data-testid="hud-notice-column"
								className={styles.hudNoticeColumn}
							>
								{systemLocaleSuggestion && (
									<HudNotice
										title={t("systemLanguagePrompt.title")}
										description={t("systemLanguagePrompt.description", {
											language: suggestedLanguageName,
										})}
										dismissLabel={t("systemLanguagePrompt.keepDefault")}
										confirmLabel={t("systemLanguagePrompt.switch", {
											language: suggestedLanguageName,
										})}
										onDismiss={dismissSystemLocaleSuggestion}
										onConfirm={acceptSystemLocaleSuggestion}
									/>
								)}

								{softwareEncoderFallbackNoticeVisible && (
									<HudNotice
										title={t("softwareEncoderFallback.title")}
										description={t("softwareEncoderFallback.description")}
										dismissLabel={t("softwareEncoderFallback.dontShowAgain")}
										confirmLabel={t("softwareEncoderFallback.dismiss")}
										onDismiss={dismissSoftwareFallbackForever}
										onConfirm={dismissSoftwareFallbackOnce}
									/>
								)}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
