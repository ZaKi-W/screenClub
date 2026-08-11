import {
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
} from "@/components/video-editor/editorDefaults";
import type {
	ExportCompressionPreset,
	ExportFormat,
	ExportQuality,
	ExportResolution,
	ExportVideoCodec,
} from "@/lib/exporter";
import { type AspectRatio, isAspectRatio } from "@/utils/aspectRatioUtils";

const PREFS_KEY = "openscreen_user_preferences";

export interface UserPreferences {
	/** Default padding % */
	padding: number;
	/** Default aspect ratio */
	aspectRatio: AspectRatio;
	/** Default export quality */
	exportQuality: ExportQuality;
	/** Default export format */
	exportFormat: ExportFormat;
	/** Remembered MP4 output size preset */
	exportResolution: ExportResolution;
	/** Remembered purpose-based compression preset */
	exportCompression: ExportCompressionPreset;
	/** Remembered MP4 frame rate */
	exportFrameRate: 24 | 30 | 60;
	/** Remembered MP4 codec (kept in advanced settings) */
	exportCodec: ExportVideoCodec;
	/** Folder used for the most recent successful export, if any */
	exportFolder: string | null;
	/** Folder of the most recently opened project, if any */
	projectFolder: string | null;
	/** Recording HUD control layout */
	trayLayout: "horizontal" | "vertical";
	/** Countdown shown before a recording starts */
	recordingCountdownSeconds: 3 | 5 | 10;
	/** Force the Windows native recorder to use the software H.264 encoder */
	preferSoftwareEncoder: boolean;
	/** Stop showing the notice that recording fell back to software encoding */
	hideSoftwareEncoderFallbackNotice: boolean;
}

export const DEFAULT_PREFS: UserPreferences = {
	padding: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
	aspectRatio: DEFAULT_EDITOR_LAYOUT_SETTINGS.aspectRatio,
	exportQuality: DEFAULT_EXPORT_SETTINGS.quality,
	exportFormat: DEFAULT_EXPORT_SETTINGS.format,
	exportResolution: "4k",
	exportCompression: "studio",
	exportFrameRate: 60,
	exportCodec: "h264",
	exportFolder: null,
	projectFolder: null,
	trayLayout: "horizontal",
	recordingCountdownSeconds: 3,
	preferSoftwareEncoder: false,
	hideSoftwareEncoderFallbackNotice: false,
};

/** Parses stored preferences without throwing on malformed JSON. */
function safeJsonParse(text: string | null): Record<string, unknown> | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Load preferences from localStorage, falling back to defaults for missing or invalid fields. */
export function loadUserPreferences(): UserPreferences {
	let raw: Record<string, unknown> | null = null;
	try {
		raw = safeJsonParse(localStorage.getItem(PREFS_KEY));
	} catch {
		return { ...DEFAULT_PREFS };
	}
	if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };

	return {
		padding:
			typeof raw.padding === "number" &&
			Number.isFinite(raw.padding) &&
			raw.padding >= 0 &&
			raw.padding <= 100
				? raw.padding
				: DEFAULT_PREFS.padding,
		aspectRatio: isAspectRatio(raw.aspectRatio) ? raw.aspectRatio : DEFAULT_PREFS.aspectRatio,
		exportQuality:
			raw.exportQuality === "medium" ||
			raw.exportQuality === "good" ||
			raw.exportQuality === "source"
				? (raw.exportQuality as ExportQuality)
				: DEFAULT_PREFS.exportQuality,
		exportFormat:
			raw.exportFormat === "gif" || raw.exportFormat === "mp4"
				? (raw.exportFormat as ExportFormat)
				: DEFAULT_PREFS.exportFormat,
		exportResolution:
			raw.exportResolution === "720p" ||
			raw.exportResolution === "1080p" ||
			raw.exportResolution === "4k"
				? (raw.exportResolution as ExportResolution)
				: DEFAULT_PREFS.exportResolution,
		exportCompression:
			raw.exportCompression === "studio" ||
			raw.exportCompression === "social" ||
			raw.exportCompression === "web" ||
			raw.exportCompression === "web-low"
				? (raw.exportCompression as ExportCompressionPreset)
				: DEFAULT_PREFS.exportCompression,
		exportFrameRate:
			raw.exportFrameRate === 24 || raw.exportFrameRate === 30 || raw.exportFrameRate === 60
				? raw.exportFrameRate
				: DEFAULT_PREFS.exportFrameRate,
		exportCodec:
			raw.exportCodec === "h264" || raw.exportCodec === "h265"
				? raw.exportCodec
				: DEFAULT_PREFS.exportCodec,
		exportFolder:
			typeof raw.exportFolder === "string" && raw.exportFolder.length > 0
				? raw.exportFolder
				: DEFAULT_PREFS.exportFolder,
		projectFolder:
			typeof raw.projectFolder === "string" && raw.projectFolder.length > 0
				? raw.projectFolder
				: DEFAULT_PREFS.projectFolder,
		trayLayout:
			raw.trayLayout === "horizontal" || raw.trayLayout === "vertical"
				? raw.trayLayout
				: DEFAULT_PREFS.trayLayout,
		recordingCountdownSeconds:
			raw.recordingCountdownSeconds === 3 ||
			raw.recordingCountdownSeconds === 5 ||
			raw.recordingCountdownSeconds === 10
				? raw.recordingCountdownSeconds
				: DEFAULT_PREFS.recordingCountdownSeconds,
		preferSoftwareEncoder:
			typeof raw.preferSoftwareEncoder === "boolean"
				? raw.preferSoftwareEncoder
				: DEFAULT_PREFS.preferSoftwareEncoder,
		hideSoftwareEncoderFallbackNotice:
			typeof raw.hideSoftwareEncoderFallbackNotice === "boolean"
				? raw.hideSoftwareEncoderFallbackNotice
				: DEFAULT_PREFS.hideSoftwareEncoderFallbackNotice,
	};
}

/**
 * Parent directory of a saved file path. Handles both POSIX and Windows
 * separators since the path comes from the OS save dialog. Root dirs keep their
 * trailing separator so the result stays a valid directory ("/video.mp4" -> "/",
 * "C:\\video.mp4" -> "C:\\"). Returns null if no separator is found.
 */
export function parentDirectoryOf(filePath: string): string | null {
	const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
	if (lastSep < 0) return null;

	// POSIX root, e.g. "/video.mp4" -> "/"
	if (lastSep === 0) return filePath[0];

	// Windows drive root, e.g. "C:\\video.mp4" -> "C:\\"
	if (lastSep === 2 && /^[A-Za-z]:[/\\]/.test(filePath)) {
		return filePath.slice(0, lastSep + 1);
	}

	return filePath.slice(0, lastSep);
}

/** Remembered export folder as `string | undefined`, for IPC handlers that treat absence as "use the default". */
export function getExportFolder(): string | undefined {
	return loadUserPreferences().exportFolder ?? undefined;
}

/** Remembered open-project folder as `string | undefined`, for IPC handlers that treat absence as "use the default". */
export function getProjectFolder(): string | undefined {
	return loadUserPreferences().projectFolder ?? undefined;
}

/** Persist preferences to localStorage; only the provided fields are updated. */
export function saveUserPreferences(partial: Partial<UserPreferences>): void {
	const current = loadUserPreferences();
	const merged = { ...current, ...partial };
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
	} catch {
		// localStorage may be unavailable (e.g. private browsing, quota exceeded)
	}
}
