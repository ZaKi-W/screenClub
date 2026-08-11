export type HudNativeInputMenuKind = "camera" | "microphone" | "system-audio";

export interface HudNativeInputMenuItem {
	id: string;
	label: string;
}

export interface HudNativeInputMenuRequest {
	kind: HudNativeInputMenuKind;
	items: HudNativeInputMenuItem[];
	activeId?: string;
	enabled: boolean;
	enableLabel: string;
	disableLabel: string;
	emptyLabel: string;
}

export type HudNativeInputMenuResult =
	| { action: "select"; id: string }
	| { action: "enable" }
	| { action: "disable" }
	| null;

export interface HudNativeSettingsMenuRequest {
	showNotes: boolean;
	showCursorMode: boolean;
	editableCursor: boolean;
	verticalLayout: boolean;
	countdownSeconds: 3 | 5 | 10;
	activeLocale: string;
	locales: Array<{ id: string; label: string }>;
	labels: {
		notes: string;
		countdown: string;
		countdownThreeSeconds: string;
		countdownFiveSeconds: string;
		countdownTenSeconds: string;
		advanced: string;
		editableCursor: string;
		systemCursor: string;
		horizontalLayout: string;
		verticalLayout: string;
		language: string;
		openStudio: string;
	};
}

export type HudNativeSettingsMenuResult =
	| { action: "notes" }
	| { action: "cursor"; mode: "editable-overlay" | "system" }
	| { action: "layout"; layout: "horizontal" | "vertical" }
	| { action: "countdown"; seconds: 3 | 5 | 10 }
	| { action: "locale"; locale: string }
	| { action: "studio" }
	| null;
