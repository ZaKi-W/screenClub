import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions,
	type Rectangle,
	screen,
} from "electron";
import type {
	CameraOverlayPrepareRequest,
	RendererCameraPreviewFrame,
} from "../src/lib/cameraOverlay";
import type { CaptureAreaSelection } from "../src/lib/captureArea";
import type {
	HudNativeInputMenuRequest,
	HudNativeInputMenuResult,
	HudNativeSettingsMenuRequest,
	HudNativeSettingsMenuResult,
} from "../src/lib/hudNativeMenu";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const HEADLESS = process.env["HEADLESS"] === "true";

// The HUD and Notes windows are excluded from every screen/window capture (WGC on Windows uses
// the same SetWindowDisplayAffinity this sets), so the recording controls never end up baked into
// the recorded video.
//
// The side effect is that they are equally invisible to an *agent's* screenshots, and the HUD is
// what opens the editor — which makes a whole slice of the app unreachable from automation. Hence
// this escape hatch, for testing only. It warns on every window it skips, because a recording made
// while it is set WILL contain the HUD.
const CONTENT_PROTECTION_DISABLED = process.env["OPENSCREEN_DISABLE_CONTENT_PROTECTION"] === "1";

// Forces protection back on where it is auto-disabled below, so the macOS
// regression can be re-tested against a future Electron without editing code.
const CONTENT_PROTECTION_FORCED = process.env["OPENSCREEN_FORCE_CONTENT_PROTECTION"] === "1";

/**
 * macOS 26 (Darwin 25) never displays a window that has had
 * `setContentProtection(true)` applied to it.
 *
 * Not "excludes it from captures" — which is the documented behaviour and the
 * whole point — but never paints it for the user either. Confirmed on Darwin
 * 25.5 / Electron 41.2.1 with the HUD: tray icon present, renderer alive and
 * painting (React mounted, no console errors), `ready-to-show` fired, `show()`
 * called, window at valid on-screen coordinates on the main display — and
 * nothing on screen. `showMainWindow()` from the tray and the global shortcut
 * were equally inert, because the window was already "visible" as far as
 * Electron was concerned. Unsetting protection makes it appear instantly; the
 * ordering of protect-vs-show makes no difference, so it is the call itself.
 *
 * `setContentProtection` maps to `NSWindow.sharingType = NSWindowSharingNone`,
 * a path Electron has repeatedly churned on (electron/electron#45990, and
 * PR #46886 reverting a macOS content-protection refactor).
 *
 * Gated on the Darwin major version rather than `darwin` wholesale: the
 * breakage is only *confirmed* on 25.x, and silently dropping protection on
 * older macOS — where it may well work — would be a privacy regression made on
 * no evidence.
 *
 * NOTE: ScreenCaptureKit ignores `sharingType`, so native display capture must
 * explicitly exclude our HUD and Notes windows. The ScreenClub helper does that
 * with `SCContentFilter(display:excludingWindows:)`; other recording apps may
 * still capture these windows on macOS 26.
 */
const CONTENT_PROTECTION_BREAKS_DISPLAY = (() => {
	if (process.platform !== "darwin") return false;
	// getSystemVersion() reports the *macOS* version on darwin, not the Darwin
	// kernel version: measured "26.5.0" here where `os.release()` is "25.5.0".
	// So the affected major is 26, and the check must not be fed os.release().
	const macOSMajor = Number.parseInt(process.getSystemVersion().split(".")[0] ?? "", 10);
	return Number.isFinite(macOSMajor) && macOSMajor >= 26;
})();

function applyContentProtection(win: BrowserWindow, label: string) {
	if (CONTENT_PROTECTION_DISABLED) {
		console.warn(
			`[content-protection] OFF for the ${label} window ` +
				"(OPENSCREEN_DISABLE_CONTENT_PROTECTION=1) — it will appear in screen captures, " +
				"including recordings. Unset it for anything but automated testing.",
		);
		return;
	}
	if (CONTENT_PROTECTION_BREAKS_DISPLAY && !CONTENT_PROTECTION_FORCED) {
		console.warn(
			`[content-protection] OFF for the ${label} window — macOS ` +
				`${process.getSystemVersion()} never displays a content-protected window, so ` +
				"enabling it would make this window permanently invisible. It may therefore appear " +
				"in screen captures. Set OPENSCREEN_FORCE_CONTENT_PROTECTION=1 to re-test.",
		);
		return;
	}
	win.setContentProtection(true);
}

// Asset base URL for renderer (wallpapers, etc.). Packaged: extraResources copies
// public/wallpapers to resources/wallpapers. Unpackaged: <appRoot>/public/.
const ASSET_BASE_DIR = process.defaultApp
	? path.join(__dirname, "..", "public")
	: process.resourcesPath;
export const ASSET_BASE_URL_ARG = `--asset-base-url=${pathToFileURL(`${ASSET_BASE_DIR}${path.sep}`).toString()}`;

let hudOverlayWindow: BrowserWindow | null = null;
let cameraOverlayWindow: BrowserWindow | null = null;
let areaSelectorWindow: BrowserWindow | null = null;
let resolveAreaSelection: ((selection: CaptureAreaSelection | null) => void) | null = null;

// Origin the current drag gesture started from. The renderer sends the pointer's
// *total* travel since pointerdown rather than per-frame deltas, so every move is
// an absolute `origin + delta` — no rounding to accumulate, and a dropped message
// self-corrects on the next one instead of leaving the window permanently offset.
let hudDragOrigin: { x: number; y: number } | null = null;

const CAMERA_OVERLAY_WIDTH = 292;
const CAMERA_OVERLAY_HEIGHT = 228;
const CAMERA_OVERLAY_MARGIN = 24;
const cameraOverlayPositionPath = path.join(
	app.getPath("userData"),
	"camera-overlay-position.json",
);

function clampBoundsToWorkArea(bounds: Rectangle): Rectangle {
	const display = screen.getDisplayMatching(bounds);
	const { workArea } = display;
	return {
		x: Math.min(Math.max(workArea.x, bounds.x), workArea.x + workArea.width - bounds.width),
		y: Math.min(Math.max(workArea.y, bounds.y), workArea.y + workArea.height - bounds.height),
		width: bounds.width,
		height: bounds.height,
	};
}

async function loadCameraOverlayBounds(): Promise<Rectangle> {
	const { workArea } = screen.getPrimaryDisplay();
	const fallback = {
		x: workArea.x + workArea.width - CAMERA_OVERLAY_WIDTH - CAMERA_OVERLAY_MARGIN,
		y: workArea.y + workArea.height - CAMERA_OVERLAY_HEIGHT - CAMERA_OVERLAY_MARGIN,
		width: CAMERA_OVERLAY_WIDTH,
		height: CAMERA_OVERLAY_HEIGHT,
	};
	try {
		const raw = JSON.parse(await readFile(cameraOverlayPositionPath, "utf8")) as Partial<Rectangle>;
		if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return fallback;
		return clampBoundsToWorkArea({
			...fallback,
			x: Math.round(raw.x ?? fallback.x),
			y: Math.round(raw.y ?? fallback.y),
		});
	} catch {
		return fallback;
	}
}

function persistCameraOverlayPosition(win: BrowserWindow) {
	const { x, y } = win.getBounds();
	void writeFile(cameraOverlayPositionPath, JSON.stringify({ x, y }), "utf8").catch((error) =>
		console.warn("Failed to remember camera preview position:", error),
	);
}

export function getCameraOverlayWindow(): BrowserWindow | null {
	return cameraOverlayWindow && !cameraOverlayWindow.isDestroyed() ? cameraOverlayWindow : null;
}

export function closeCameraOverlayWindow() {
	const win = getCameraOverlayWindow();
	if (win) win.close();
	cameraOverlayWindow = null;
}

export async function createCameraOverlayWindow(
	request: CameraOverlayPrepareRequest,
): Promise<BrowserWindow | null> {
	// Wayland does not let clients position their own windows or exclude them from a
	// portal capture. Showing the preview there would silently burn it into the screen track.
	if (process.platform === "linux") {
		return null;
	}
	if (
		process.platform === "darwin" &&
		request.captureBackend === "browser" &&
		CONTENT_PROTECTION_BREAKS_DISPLAY &&
		!CONTENT_PROTECTION_FORCED
	) {
		return null;
	}

	closeCameraOverlayWindow();
	const bounds = await loadCameraOverlayBounds();
	const win = new BrowserWindow({
		...bounds,
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		transparent: true,
		backgroundColor: "#00000000",
		roundedCorners: false,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	applyContentProtection(win, "Camera preview");
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}
	win.setAlwaysOnTop(true, "floating");
	win.once("ready-to-show", () => {
		applyContentProtection(win, "Camera preview");
		if (!HEADLESS) win.showInactive();
	});
	win.on("moved", () => {
		if (win.isDestroyed()) return;
		const clamped = clampBoundsToWorkArea(win.getBounds());
		if (clamped.x !== win.getBounds().x || clamped.y !== win.getBounds().y) {
			win.setBounds(clamped, false);
		}
		persistCameraOverlayPosition(win);
	});
	win.on("closed", () => {
		if (cameraOverlayWindow === win) cameraOverlayWindow = null;
		for (const candidate of BrowserWindow.getAllWindows()) {
			if (candidate.webContents.getURL().includes("windowType=hud-overlay")) {
				candidate.webContents.send("camera-overlay-hidden");
			}
		}
	});
	cameraOverlayWindow = win;

	const query = {
		windowType: "camera-overlay",
		previewSource:
			request.captureBackend === "native-windows"
				? "native"
				: request.captureBackend === "native-mac"
					? "direct"
					: "browser",
		...(request.deviceId ? { deviceId: request.deviceId } : {}),
	};
	if (VITE_DEV_SERVER_URL) {
		await win.loadURL(`${VITE_DEV_SERVER_URL}?${new URLSearchParams(query).toString()}`);
	} else {
		await win.loadFile(path.join(RENDERER_DIST, "index.html"), { query });
	}
	return win;
}

ipcMain.handle("camera-overlay-prepare", async (_event, request: CameraOverlayPrepareRequest) => {
	if (
		!request ||
		!(["native-mac", "native-windows", "browser"] as const).includes(request.captureBackend)
	) {
		return { shown: false, reason: "invalid-request" };
	}
	const win = await createCameraOverlayWindow(request);
	return win ? { shown: true } : { shown: false, reason: "unsupported-platform" };
});

ipcMain.on("camera-overlay-hide", () => closeCameraOverlayWindow());

ipcMain.on("camera-overlay-renderer-frame", (event, frame: RendererCameraPreviewFrame) => {
	if (
		!event.sender.getURL().includes("windowType=hud-overlay") ||
		frame?.mimeType !== "image/webp" ||
		!(frame.data instanceof ArrayBuffer) ||
		frame.data.byteLength === 0 ||
		frame.data.byteLength > 2_000_000
	) {
		return;
	}
	getCameraOverlayWindow()?.webContents.send("camera-overlay-renderer-frame", frame);
});

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
});

function parseHudNativeInputMenuRequest(value: unknown): HudNativeInputMenuRequest | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<HudNativeInputMenuRequest>;
	const kind = candidate.kind;
	if (
		(kind !== "camera" && kind !== "microphone" && kind !== "system-audio") ||
		typeof candidate.enabled !== "boolean" ||
		typeof candidate.enableLabel !== "string" ||
		typeof candidate.disableLabel !== "string" ||
		typeof candidate.emptyLabel !== "string" ||
		!Array.isArray(candidate.items)
	) {
		return null;
	}

	const items = candidate.items
		.filter(
			(item): item is { id: string; label: string } =>
				Boolean(item) &&
				typeof item === "object" &&
				typeof item.id === "string" &&
				typeof item.label === "string",
		)
		.slice(0, 100)
		.map((item) => ({ id: item.id.slice(0, 512), label: item.label.slice(0, 512) }));

	return {
		kind,
		items,
		activeId: typeof candidate.activeId === "string" ? candidate.activeId : undefined,
		enabled: candidate.enabled,
		enableLabel: candidate.enableLabel.slice(0, 512),
		disableLabel: candidate.disableLabel.slice(0, 512),
		emptyLabel: candidate.emptyLabel.slice(0, 512),
	};
}

ipcMain.handle(
	"hud-show-native-input-menu",
	(_event, rawRequest: unknown): Promise<HudNativeInputMenuResult> => {
		const request = parseHudNativeInputMenuRequest(rawRequest);
		if (!request || !hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
			return Promise.resolve(null);
		}
		const menuWindow = hudOverlayWindow;

		return new Promise((resolve) => {
			let settled = false;
			const finish = (result: HudNativeInputMenuResult) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};

			const template: MenuItemConstructorOptions[] = [];
			if (request.kind === "system-audio") {
				template.push({
					label: request.enableLabel,
					type: "checkbox",
					checked: request.enabled,
					click: () => finish({ action: "enable" }),
				});
			} else if (request.items.length > 0) {
				template.push(
					...request.items.map<MenuItemConstructorOptions>((item) => ({
						label: item.label,
						type: "checkbox",
						checked: request.enabled && item.id === request.activeId,
						click: () => finish({ action: "select", id: item.id }),
					})),
				);
			} else {
				template.push({ label: request.emptyLabel, enabled: false });
			}

			template.push(
				{ type: "separator" },
				{
					label: request.disableLabel,
					type: "checkbox",
					checked: !request.enabled,
					click: () => finish({ action: "disable" }),
				},
			);

			Menu.buildFromTemplate(template).popup({
				window: menuWindow,
				callback: () => finish(null),
			});
		});
	},
);

ipcMain.handle(
	"hud-show-native-settings-menu",
	(_event, request: HudNativeSettingsMenuRequest): Promise<HudNativeSettingsMenuResult> => {
		if (!request || !hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
			return Promise.resolve(null);
		}
		const menuWindow = hudOverlayWindow;

		return new Promise((resolve) => {
			let settled = false;
			const finish = (result: HudNativeSettingsMenuResult) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};
			const advancedSubmenu: MenuItemConstructorOptions[] = [];
			if (request.showCursorMode) {
				advancedSubmenu.push(
					{
						label: request.labels.editableCursor,
						type: "radio",
						checked: request.editableCursor,
						click: () => finish({ action: "cursor", mode: "editable-overlay" }),
					},
					{
						label: request.labels.systemCursor,
						type: "radio",
						checked: !request.editableCursor,
						click: () => finish({ action: "cursor", mode: "system" }),
					},
					{ type: "separator" },
				);
			}
			advancedSubmenu.push(
				{
					label: request.labels.horizontalLayout,
					type: "radio",
					checked: !request.verticalLayout,
					click: () => finish({ action: "layout", layout: "horizontal" }),
				},
				{
					label: request.labels.verticalLayout,
					type: "radio",
					checked: request.verticalLayout,
					click: () => finish({ action: "layout", layout: "vertical" }),
				},
				{ type: "separator" },
				{
					label: request.labels.language,
					submenu: request.locales.map((locale) => ({
						label: locale.label,
						type: "radio" as const,
						checked: locale.id === request.activeLocale,
						click: () => finish({ action: "locale", locale: locale.id }),
					})),
				},
			);

			const template: MenuItemConstructorOptions[] = [
				...(request.showNotes
					? [{ label: request.labels.notes, click: () => finish({ action: "notes" as const }) }]
					: []),
				{
					label: request.labels.countdown,
					submenu: (
						[
							[3, request.labels.countdownThreeSeconds],
							[5, request.labels.countdownFiveSeconds],
							[10, request.labels.countdownTenSeconds],
						] as const
					).map(([seconds, label]) => ({
						label,
						type: "radio" as const,
						checked: request.countdownSeconds === seconds,
						click: () => finish({ action: "countdown", seconds }),
					})),
				},
				{ label: request.labels.advanced, submenu: advancedSubmenu },
				{ type: "separator" },
				{ label: request.labels.openStudio, click: () => finish({ action: "studio" }) },
			];

			Menu.buildFromTemplate(template).popup({
				window: menuWindow,
				callback: () => finish(null),
			});
		});
	},
);

function finishAreaSelection(selection: CaptureAreaSelection | null) {
	const resolve = resolveAreaSelection;
	resolveAreaSelection = null;
	resolve?.(selection);
	if (areaSelectorWindow && !areaSelectorWindow.isDestroyed()) {
		areaSelectorWindow.close();
	}
	areaSelectorWindow = null;
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.show();
		hudOverlayWindow.focus();
	}
}

ipcMain.on("hud-area-selector-confirm", (_event, selection: CaptureAreaSelection) => {
	if (
		!selection ||
		!Number.isFinite(selection.displayId) ||
		!selection.rect ||
		!Number.isFinite(selection.rect.x) ||
		!Number.isFinite(selection.rect.y) ||
		!Number.isFinite(selection.rect.width) ||
		!Number.isFinite(selection.rect.height) ||
		selection.rect.width < 2 ||
		selection.rect.height < 2
	) {
		return;
	}
	finishAreaSelection(selection);
});

ipcMain.on("hud-area-selector-cancel", () => finishAreaSelection(null));

ipcMain.handle("hud-open-area-selector", (): Promise<CaptureAreaSelection | null> => {
	if (process.platform !== "darwin") return Promise.resolve(null);
	if (areaSelectorWindow && !areaSelectorWindow.isDestroyed()) {
		areaSelectorWindow.focus();
		return Promise.resolve(null);
	}

	const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const { bounds } = display;
	const win = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		fullscreenable: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
		},
	});
	areaSelectorWindow = win;
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) hudOverlayWindow.hide();
	win.setAlwaysOnTop(true, "screen-saver");
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	win.on("closed", () => {
		if (areaSelectorWindow === win) areaSelectorWindow = null;
		const resolve = resolveAreaSelection;
		resolveAreaSelection = null;
		resolve?.(null);
		if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) hudOverlayWindow.show();
	});
	const query = { windowType: "area-selector", displayId: String(display.id) };
	if (VITE_DEV_SERVER_URL) {
		void win.loadURL(`${VITE_DEV_SERVER_URL}?${new URLSearchParams(query).toString()}`);
	} else {
		void win.loadFile(path.join(RENDERER_DIST, "index.html"), { query });
	}

	return new Promise((resolve) => {
		resolveAreaSelection = resolve;
	});
});

ipcMain.on("hud-overlay-ignore-mouse-events", (_event, ignore: boolean) => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
	}
});

ipcMain.on("hud-overlay-drag-start", () => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	// Under Wayland this origin is a lie: Electron documents getPosition() as returning
	// [0, 0] there, because the protocol prohibits a client from introspecting or
	// setting its own global coordinates. The origin+delta scheme below therefore
	// resolves against 0 rather than the window's real position, and setPosition() is
	// itself a no-op — so dragging cannot work on Wayland by this route at all. The
	// finiteness check only keeps a garbage origin from reaching a native setter.
	const [x, y] = hudOverlayWindow.getPosition();
	hudDragOrigin = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
});

ipcMain.on("hud-overlay-drag-to", (_event, deltaX: number, deltaY: number) => {
	if (
		!hudOverlayWindow ||
		hudOverlayWindow.isDestroyed() ||
		!hudDragOrigin ||
		!Number.isFinite(deltaX) ||
		!Number.isFinite(deltaY)
	) {
		return;
	}

	// `| 0` is load-bearing, not defensive noise. Math.round returns NEGATIVE ZERO for
	// any delta in [-0.5, 0) — routine under fractional scaling, where screenY deltas
	// are fractional. V8's IsInt32() rejects -0, so gin refuses to convert it and the
	// main process dies with "Error processing argument at index 1, conversion failure
	// from". `Number.isFinite(-0)` is true, so a finiteness check does NOT catch this;
	// `| 0` collapses -0 to 0 and pins the value to int32. (`+ 0` would not: -0 + 0 is
	// still -0, and Math.trunc preserves it too.)
	const x = Math.round(hudDragOrigin.x + deltaX) | 0;
	const y = Math.round(hudDragOrigin.y + deltaY) | 0;

	hudOverlayWindow.setPosition(x, y, false);
});

ipcMain.on("hud-overlay-drag-end", () => {
	hudDragOrigin = null;
});

// Resize the HUD to fit its rendered content. Anchored by its bottom-centre so it
// stays where the user dragged it while only growing/shrinking, which lets the
// vertical tray layout grow tall instead of scrolling inside a fixed window.
//
// Applied in one shot rather than tweened. The renderer now reserves space for
// everything that can float above the bar, so a resize only ever accompanies a
// discrete content change (orientation flip, recording controls appearing) that
// snaps anyway — tweening the window across 10 frames just meant 10 frames of the
// bar sitting at an offset that didn't match the content it was drawn with.
ipcMain.on("hud-overlay-set-size", (_event, width: number, height: number) => {
	if (
		!hudOverlayWindow ||
		hudOverlayWindow.isDestroyed() ||
		!Number.isFinite(width) ||
		!Number.isFinite(height)
	) {
		return;
	}

	// A resize re-anchors from the window's current bounds, which would fight the
	// position an in-flight drag is applying. The renderer re-measures on release.
	if (hudDragOrigin) {
		return;
	}

	const bounds = hudOverlayWindow.getBounds();

	// Clamp to the work area of the display the HUD sits on; on a short screen the
	// vertical layout can exceed the display, where the bar's own overflow scroll takes over.
	const { workArea } = screen.getDisplayMatching(bounds);
	const nextWidth = Math.min(workArea.width, Math.max(1, Math.round(width)));
	const nextHeight = Math.min(workArea.height, Math.max(1, Math.round(height)));

	if (bounds.width === nextWidth && bounds.height === nextHeight) {
		return;
	}

	const centerX = bounds.x + bounds.width / 2;
	const bottomY = bounds.y + bounds.height;

	// Growing height keeps the bottom edge anchored (so the vertical tray grows
	// upward from where the user left it), but that alone can push the top edge
	// above the screen — e.g. switching to the tall vertical layout while sitting
	// low/mid-screen. The drag handle lives at the tray's start (top, in vertical
	// mode), so an off-screen top edge makes the HUD both invisible and
	// undraggable back into view. Clamp both axes to the display's work area so
	// the window (and its drag handle) always stays fully reachable.
	const nextX = Math.min(
		Math.max(workArea.x, Math.round(centerX - nextWidth / 2)),
		workArea.x + workArea.width - nextWidth,
	);
	const nextY = Math.min(
		Math.max(workArea.y, Math.round(bottomY - nextHeight)),
		workArea.y + workArea.height - nextHeight,
	);

	hudOverlayWindow.setBounds({
		x: nextX,
		y: nextY,
		width: nextWidth,
		height: nextHeight,
	});
});

/**
 * Frameless transparent HUD overlay, always-on-top, centred at the bottom of the
 * primary display. Follows the user across macOS Spaces so it isn't lost on switch.
 */
export function createHudOverlayWindow(): BrowserWindow {
	const primaryDisplay = screen.getPrimaryDisplay();
	const { workArea } = primaryDisplay;

	// Close to what the renderer asks for on its very first measurement (bar plus
	// the reserved space above it), so the HUD doesn't visibly resize itself the
	// instant it becomes visible. See src/components/launch/hudGeometry.ts.
	const windowWidth = 820;
	const windowHeight = 560;

	const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
	const y = Math.floor(workArea.y + workArea.height - windowHeight - 5);

	const win = new BrowserWindow({
		width: windowWidth,
		height: windowHeight,
		// Min/max are intentionally loose: the renderer resizes to fit content via
		// "hud-overlay-set-size" (above), including the compact recording stop button.
		minWidth: 1,
		minHeight: 1,
		x: x,
		y: y,
		frame: false,
		transparent: true,
		// Fully-transparent ARGB backing. Without this macOS draws the window as a
		// rounded glass panel with a border around the HUD content.
		backgroundColor: "#00000000",
		// Don't let macOS mask the window into a rounded rect; the HUD bar provides
		// its own rounding and the window itself must be invisible.
		roundedCorners: false,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false, // shown via ready-to-show to avoid black rectangle flash
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			// Recording, device monitoring and the elapsed-time display must keep
			// running when another window temporarily covers the HUD.
			backgroundThrottling: false,
		},
	});

	// Deliberately NOT born click-through: the renderer asks for it on mount, over
	// "hud-overlay-ignore-mouse-events" (`show: false` holds this window back until
	// ready-to-show, so the two are ~85 ms apart — measured, not assumed). What that
	// leaves open is an invisible rectangle that can swallow one desktop click in
	// those 85 ms, right after the user launched the app — against what doing it here
	// cost them: the whole app (issue #266). On Windows the `forward` option is a global
	// WH_MOUSE_LL hook, and that hook is the only way out of the state, because
	// Chromium sends no pointermove to a window it has made input-transparent — so
	// the renderer can never ask to leave it on its own. Electron latches
	// the install behind `forwarding_mouse_messages_` and retries only after a
	// setIgnoreMouseEvents(false) — the very call a dead hook prevents. One refused
	// or revoked hook (Windows drops any whose callback overruns the 300 ms
	// LowLevelHooksTimeout — on this thread, still busy booting the app) and the HUD
	// is painted, inert, forever. Asking later moves the install onto an IPC message,
	// i.e. onto a main thread that is provably pumping.

	// Keep the recording controls out of the recording (see applyContentProtection).
	applyContentProtection(win, "HUD");

	// Follow the user across macOS Spaces, else the HUD stays pinned to the Space
	// it was first opened on.
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	// Show only once painted to avoid the black rectangle flash when a transparent
	// window is shown before its first paint.
	win.once("ready-to-show", () => {
		applyContentProtection(win, "HUD");
		if (!HEADLESS) win.show();
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
	});

	hudOverlayWindow = win;

	win.on("closed", () => {
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
			hudDragOrigin = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=hud-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "hud-overlay" },
		});
	}

	return win;
}

/**
 * Main editor window. Starts maximised with a hidden title bar on macOS; not
 * always-on-top and appears in the taskbar/dock.
 *
 * `query` overrides the renderer's routing params. The export bench passes
 * windowType=bench so it runs under THIS window's webPreferences — same
 * preload, same sandbox, same backgroundThrottling:false — because a bench that
 * configures its own window measures a different app than the one we ship.
 */
export function createEditorWindow(query: Record<string, string> = {}): BrowserWindow {
	const isMac = process.platform === "darwin";

	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		// Seamless titlebar on every platform: the app's own topbar IS the titlebar
		// (it already carries the logo, the title and a drag region). macOS keeps its
		// traffic lights, Windows/Linux get the native Window Controls Overlay — which
		// preserves Snap Layouts and the system close/maximise semantics instead of
		// re-implementing them as HTML buttons. Its colours follow the app theme via
		// the "set-titlebar-overlay" IPC (see handlers.ts).
		titleBarStyle: "hidden",
		...(isMac
			? { trafficLightPosition: { x: 18, y: 21 } }
			: { titleBarOverlay: { color: "#000000", symbolColor: "#95a4aa", height: 58 } }),
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: "ScreenClub",
		backgroundColor: "#000000",
		show: false, // shown via ready-to-show to avoid white flash on first load
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	win.maximize();

	// The editor renders its own File/Edit/View menu bar in the custom titlebar,
	// so hide the native OS menu bar on Windows/Linux (it stays reachable via Alt).
	// macOS keeps its global menu bar.
	if (process.platform !== "darwin") {
		win.setAutoHideMenuBar(true);
	}

	// Show only once painted to avoid a white flash on cold Vite start.
	win.once("ready-to-show", () => {
		if (!HEADLESS) win.show();
	});

	// Inject dark background before any React paint so the sub-titlebar area never
	// flashes white on a cold Vite load.
	win.webContents.on("dom-ready", () => {
		// `--titlebar-inset-left` reserves room for the macOS traffic lights; on
		// Windows/Linux the topbar uses the `titlebar-area-*` env vars instead.
		win.webContents
			.insertCSS(
				`html, body, #root { background: #09090b !important; }
				 :root { --titlebar-inset-left: ${isMac ? "68px" : "0px"}; }`,
			)
			.catch(() => {
				// Best-effort cosmetic; ignore if the page is mid-teardown.
			});
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
	});

	const routing = { windowType: "editor", ...query };
	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?${new URLSearchParams(routing).toString()}`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), { query: routing });
	}

	return win;
}

/**
 * Floating source-selector window for picking a screen or window to record.
 * Frameless, transparent, and follows the user across macOS Spaces.
 */
export function createSourceSelectorWindow(
	preferredSourceKind?: "screen" | "window",
): BrowserWindow {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: 680,
		height: 580,
		minHeight: 420,
		maxHeight: 680,
		x: Math.round((width - 680) / 2),
		y: Math.round((height - 580) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	// Follow the user across macOS Spaces so the selector appears on the active
	// desktop regardless of where the HUD was opened.
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	const routing = {
		windowType: "source-selector",
		...(preferredSourceKind ? { preferredSourceKind } : {}),
	};
	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?${new URLSearchParams(routing).toString()}`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: routing,
		});
	}

	return win;
}

/**
 * Centered transparent countdown overlay that sits above the HUD during
 * recording pre-roll.
 */
export function createCountdownOverlayWindow(): BrowserWindow {
	const { workArea } = screen.getPrimaryDisplay();
	const overlayWidth = 420;
	const overlayHeight = 260;

	const win = new BrowserWindow({
		width: overlayWidth,
		height: overlayHeight,
		minWidth: overlayWidth,
		maxWidth: overlayWidth,
		minHeight: overlayHeight,
		maxHeight: overlayHeight,
		x: Math.round(workArea.x + (workArea.width - overlayWidth) / 2),
		y: Math.round(workArea.y + (workArea.height - overlayHeight) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		focusable: false,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.setIgnoreMouseEvents(true);

	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown-overlay" },
		});
	}

	return win;
}

// Frameless Notes Window for taking notes during a recording.
export function createNotesWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 400,
		height: 540,
		minWidth: 360,
		minHeight: 400,
		maxWidth: 640,
		maxHeight: 720,
		title: "ScreenClub - Notes",
		backgroundColor: "#000000",
		resizable: true,
		alwaysOnTop: true,
		skipTaskbar: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	// Match the editor: no native OS menu bar on Windows/Linux (reachable via Alt).
	if (process.platform !== "darwin") {
		win.setAutoHideMenuBar(true);
	}

	applyContentProtection(win, "Notes");
	win.once("ready-to-show", () => {
		applyContentProtection(win, "Notes");
		win.show();
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?showNotes=true");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { showNotes: "true" },
		});
	}

	return win;
}
