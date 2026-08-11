import {
	AppWindow,
	Check,
	ChevronDown,
	CircleStop,
	Clapperboard,
	Languages,
	Mic,
	MicOff,
	Monitor,
	MonitorSpeaker,
	MousePointer2,
	NotepadText,
	Pause,
	Play,
	RotateCcw,
	Scan,
	Settings,
	Trash2,
	Video,
	VideoOff,
	X,
} from "lucide-react";
import { memo } from "react";
import { formatTimePadded } from "../../utils/timeUtils";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import {
	CameraIcon,
	CursorIcon,
	getIcon,
	ICON_SIZE,
	MicIcon,
	OpenInEditorIcon,
	OrientationIcon,
	SourceIcon,
	VolumeIcon,
} from "./HudIcons";
import { HudMagneticButton } from "./HudMagneticButton";
import styles from "./LaunchWindow.module.css";

// Every control below is a `memo` boundary on purpose. The HUD's root re-renders
// once a second for the whole duration of a recording (the elapsed-time counter),
// and without these boundaries each of those ticks rebuilt ~10 Radix tooltip trees
// and ~60 host elements. Props are kept primitive (or stable refs/callbacks from
// the parent) so the boundaries actually hold.

const hudDisabledClasses =
	"disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none";

// Exact values from the design's renderVals() (comfortable density, rounded
// shape, #10b981 accent) — btnSize 34 / btnRadius 10 / containerRadius 17
// (btnRadius + padY) / dividerLen 22. Every control is its own standalone
// transparent icon button (no shared "group" pill background) — grouping
// reads purely from proximity + the divider spans between logical sections.
const hudIconBtnClasses = `flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent cursor-pointer text-[#828c99] transition-all duration-150 hover:bg-[#1a1e25] hover:text-[#f5f7fa] active:scale-95 ${hudDisabledClasses} ${styles.electronNoDrag}`;

const hudAuxIconBtnClasses = `flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent cursor-pointer text-[#828c99] transition-colors duration-150 hover:bg-[#1a1e25] hover:text-[#f5f7fa] ${hudDisabledClasses}`;

const windowBtnClasses = `flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border-0 bg-transparent cursor-pointer text-[#828c99] transition-all duration-150 hover:bg-[#1a1e25] hover:text-[#e9edf3] ${hudDisabledClasses}`;

const closeBtnClasses = `flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border-0 bg-transparent cursor-pointer text-[#828c99] transition-all duration-150 hover:bg-[rgba(248,113,113,0.16)] hover:text-[#f87171] ${hudDisabledClasses}`;

const hudReferenceButtonClasses = `shrink-0 border-0 bg-transparent cursor-pointer transition-all duration-150 active:scale-[0.97] ${hudDisabledClasses} ${styles.electronNoDrag}`;

export const HudDivider = memo(function HudDivider({ vertical }: { vertical: boolean }) {
	return (
		<span
			className={`${styles.hudDivider} ${vertical ? styles.hudDividerVertical : styles.hudDividerHorizontal}`}
			aria-hidden
		/>
	);
});

export const HudDismissButton = memo(function HudDismissButton({
	label,
	disabled,
	onClick,
}: {
	label: string;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip content={label}>
			<HudMagneticButton
				type="button"
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
				className={`${hudReferenceButtonClasses} ${styles.hudDismissButton} flex h-9 w-9 items-center justify-center rounded-full`}
				highlightClassName={styles.hudMagneticHighlightLight}
			>
				<X size={21} strokeWidth={2.5} />
			</HudMagneticButton>
		</Tooltip>
	);
});

export const HudCaptureModeButton = memo(function HudCaptureModeButton({
	kind,
	label,
	active,
	disabled,
	compact,
	onClick,
}: {
	kind: "screen" | "window" | "area";
	label: string;
	active: boolean;
	disabled: boolean;
	compact: boolean;
	onClick: () => void;
}) {
	const Icon = kind === "screen" ? Monitor : kind === "window" ? AppWindow : Scan;
	return (
		<HudMagneticButton
			type="button"
			data-testid={
				kind === "screen"
					? "launch-source-selector-button"
					: kind === "window"
						? "launch-window-source-button"
						: "launch-area-source-button"
			}
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`${hudReferenceButtonClasses} flex ${compact ? "h-[50px] w-[50px]" : "h-[52px] w-[64px]"} flex-col items-center justify-center gap-0.5 rounded-[12px] ${
				active ? "bg-white/[0.11] text-white" : "text-[#a6a6a4] hover:text-white"
			}`}
		>
			<Icon size={compact ? 23 : 25} strokeWidth={1.9} />
			<span className={`${compact ? "text-[10px]" : "text-[11px]"} font-medium leading-none`}>
				{label}
			</span>
		</HudMagneticButton>
	);
});

export const HudStatusToggleButton = memo(function HudStatusToggleButton({
	kind,
	enabled,
	disabled,
	label,
	statusLabel,
	compact,
	expanded,
	onClick,
}: {
	kind: "camera" | "microphone" | "system-audio";
	enabled: boolean;
	disabled: boolean;
	label: string;
	statusLabel: string;
	compact: boolean;
	expanded: boolean;
	onClick: () => void;
}) {
	const Icon =
		kind === "camera"
			? enabled
				? Video
				: VideoOff
			: kind === "microphone"
				? enabled
					? Mic
					: MicOff
				: MonitorSpeaker;
	const testId =
		kind === "camera"
			? "launch-webcam-button"
			: kind === "microphone"
				? "launch-microphone-button"
				: "launch-system-audio-button";
	return (
		<Tooltip content={label}>
			<HudMagneticButton
				type="button"
				data-testid={testId}
				aria-label={label}
				aria-pressed={enabled}
				aria-expanded={expanded}
				aria-haspopup="menu"
				data-hud-popover-trigger="true"
				disabled={disabled}
				onClick={onClick}
				className={`${hudReferenceButtonClasses} flex ${compact ? "h-10 w-10 justify-center" : "h-[46px] min-w-[128px] max-w-[174px] gap-2 px-2.5"} items-center rounded-[12px] ${
					enabled ? "bg-white/[0.08] text-[#f4f4f2]" : "text-[#8b8b89] hover:text-[#bdbdbb]"
				}`}
			>
				<Icon size={compact ? 21 : 22} strokeWidth={1.8} />
				<span className={compact ? "sr-only" : "truncate text-[12px] font-medium"}>
					{statusLabel}
				</span>
			</HudMagneticButton>
		</Tooltip>
	);
});

export const HudDragHandle = memo(function HudDragHandle({
	vertical,
	nativeDrag,
	onPointerDown,
	onPointerMove,
	onPointerEnd,
}: {
	vertical: boolean;
	/**
	 * Hand the gesture to the compositor instead of the pointer handlers below.
	 *
	 * Wayland forbids a client from reading or setting its own global position:
	 * `getPosition()` answers [0, 0] and `setPosition()` only updates Electron's
	 * own cache, so the origin+delta scheme the handlers implement cannot move
	 * the window there. `-webkit-app-region: drag` is the one path that does —
	 * it routes to `xdg_toplevel.move` and the compositor performs the move.
	 *
	 * A drag region swallows pointer events, so the two are mutually exclusive:
	 * platforms that can position themselves keep the handler path, which gives
	 * finer control and lets the HUD suppress resizes mid-gesture.
	 */
	nativeDrag: boolean;
	onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
	onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
	onPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
	return (
		<div
			data-testid="hud-drag-handle"
			className={`flex ${vertical ? "h-3 w-11" : "h-11 w-3"} shrink-0 cursor-grab items-center justify-center active:cursor-grabbing ${
				nativeDrag ? styles.electronDrag : styles.electronNoDrag
			}`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerEnd}
			onPointerCancel={onPointerEnd}
		>
			<span
				className={`${styles.hudDivider} ${vertical ? styles.hudDividerVertical : styles.hudDividerHorizontal}`}
				aria-hidden
			/>
		</div>
	);
});

export const HudTrayLayoutButton = memo(function HudTrayLayoutButton({
	vertical,
	label,
	onClick,
}: {
	vertical: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip content={label}>
			<HudMagneticButton
				data-testid="launch-tray-layout-button"
				type="button"
				aria-label={label}
				aria-pressed={vertical}
				className={hudIconBtnClasses}
				onClick={onClick}
			>
				<OrientationIcon vertical={vertical} />
			</HudMagneticButton>
		</Tooltip>
	);
});

export const HudSourceButton = memo(function HudSourceButton({
	vertical,
	label,
	disabled,
	onClick,
}: {
	vertical: boolean;
	label: string;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			data-testid="launch-source-selector-button"
			className={`flex h-[34px] shrink-0 items-center gap-[7px] rounded-[10px] border-0 bg-transparent text-[#f5f7fa] transition-all duration-150 hover:bg-[#1a1e25] active:scale-[0.97] ${hudDisabledClasses} ${
				vertical ? "w-[34px] justify-center px-0" : "pr-3 pl-2.5"
			} ${styles.electronNoDrag}`}
			onClick={onClick}
			disabled={disabled}
			title={label}
			aria-label={label}
		>
			<SourceIcon className="shrink-0" />
			<span className={`${vertical ? "sr-only" : "max-w-[86px]"} truncate text-[13px] font-medium`}>
				{label}
			</span>
		</button>
	);
});

export const HudSystemAudioButton = memo(function HudSystemAudioButton({
	enabled,
	disabled,
	label,
	onClick,
}: {
	enabled: boolean;
	disabled: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			data-testid="launch-system-audio-button"
			className={hudIconBtnClasses}
			onClick={onClick}
			disabled={disabled}
			title={label}
		>
			<VolumeIcon muted={!enabled} className={enabled ? "text-[#10b981]" : ""} />
		</button>
	);
});

export const HudMicButton = memo(function HudMicButton({
	enabled,
	disabled,
	label,
	onClick,
}: {
	enabled: boolean;
	disabled: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			data-testid="launch-microphone-button"
			className={hudIconBtnClasses}
			aria-pressed={enabled}
			onClick={onClick}
			disabled={disabled}
			title={label}
		>
			<MicIcon muted={!enabled} className={enabled ? "text-[#10b981]" : ""} />
		</button>
	);
});

export const HudCameraButton = memo(function HudCameraButton({
	enabled,
	disabled,
	label,
	onClick,
}: {
	enabled: boolean;
	disabled: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			data-testid="launch-webcam-button"
			className={hudIconBtnClasses}
			aria-pressed={enabled}
			onClick={onClick}
			disabled={disabled}
			title={label}
		>
			<CameraIcon off={!enabled} className={enabled ? "text-[#10b981]" : ""} />
		</button>
	);
});

export const HudSettingsButton = memo(function HudSettingsButton({
	disabled,
	expanded,
	label,
	onClick,
}: {
	disabled: boolean;
	expanded: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip content={label}>
			<HudMagneticButton
				type="button"
				data-testid="launch-action-menu-button"
				aria-label={label}
				aria-expanded={expanded}
				aria-haspopup="menu"
				className={`${hudReferenceButtonClasses} flex h-10 w-[50px] items-center justify-center gap-1 rounded-[12px] text-[#a6a6a4] hover:text-white ${disabled ? "opacity-30 cursor-not-allowed pointer-events-none" : ""}`}
				onClick={onClick}
				disabled={disabled}
			>
				<Settings size={21} strokeWidth={1.8} />
				<ChevronDown
					size={14}
					strokeWidth={1.8}
					className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
				/>
			</HudMagneticButton>
		</Tooltip>
	);
});

export const HudCursorButton = memo(function HudCursorButton({
	editableOverlay,
	disabled,
	label,
	onClick,
}: {
	editableOverlay: boolean;
	disabled: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			data-testid="launch-cursor-mode-button"
			className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border-0 cursor-pointer transition-all duration-150 active:scale-95 ${hudDisabledClasses} ${styles.electronNoDrag} ${
				editableOverlay
					? "bg-[#10b981] text-[#08090d] hover:bg-[#0e9e6e]"
					: "bg-transparent text-[#828c99] hover:bg-[#1a1e25] hover:text-[#f5f7fa]"
			}`}
			onClick={onClick}
			disabled={disabled}
			title={label}
		>
			<CursorIcon />
		</button>
	);
});

export const HudCollapsedRecordingButton = memo(function HudCollapsedRecordingButton({
	saving,
	paused,
	canPause,
	elapsedSeconds,
	label,
	pauseLabel,
	restartLabel,
	cancelLabel,
	onStop,
	onTogglePause,
	onRestart,
	onCancel,
}: {
	saving: boolean;
	paused: boolean;
	canPause: boolean;
	elapsedSeconds: number;
	label: string;
	pauseLabel: string;
	restartLabel: string;
	cancelLabel: string;
	onStop: () => void;
	onTogglePause: () => void;
	onRestart: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="flex items-center gap-1.5">
			<Tooltip content={label}>
				<HudMagneticButton
					type="button"
					data-testid="hud-collapsed-recording-button"
					aria-label={label}
					title={label}
					disabled={saving}
					className={`${hudReferenceButtonClasses} flex h-12 items-center gap-2.5 rounded-[16px] px-3 text-[#ff594f]`}
					highlightClassName={styles.hudMagneticHighlightDanger}
					onClick={onStop}
				>
					{saving ? getIcon("spinner", "animate-spin") : <CircleStop size={25} strokeWidth={2.1} />}
					<span className="min-w-[46px] text-left text-[16px] font-semibold tabular-nums">
						{formatTimePadded(elapsedSeconds)}
					</span>
				</HudMagneticButton>
			</Tooltip>

			<span className="mx-1 h-10 w-px bg-white/20" aria-hidden />

			<Tooltip content={pauseLabel}>
				<HudMagneticButton
					type="button"
					aria-label={pauseLabel}
					disabled={saving || !canPause}
					className={`${hudReferenceButtonClasses} flex h-12 w-12 items-center justify-center rounded-[15px] text-[#f2f2ef]`}
					onClick={onTogglePause}
				>
					{paused ? <Play size={25} /> : <Pause size={25} />}
				</HudMagneticButton>
			</Tooltip>
			<Tooltip content={restartLabel}>
				<HudMagneticButton
					type="button"
					aria-label={restartLabel}
					disabled={saving}
					className={`${hudReferenceButtonClasses} flex h-12 w-12 items-center justify-center rounded-[15px] text-[#f2f2ef]`}
					onClick={onRestart}
				>
					<RotateCcw size={26} strokeWidth={2.1} />
				</HudMagneticButton>
			</Tooltip>
			<Tooltip content={cancelLabel}>
				<HudMagneticButton
					type="button"
					aria-label={cancelLabel}
					disabled={saving}
					className={`${hudReferenceButtonClasses} flex h-12 w-12 items-center justify-center rounded-[15px] text-[#f2f2ef] hover:text-[#ff7168]`}
					highlightClassName={styles.hudMagneticHighlightDanger}
					onClick={onCancel}
				>
					<Trash2 size={25} strokeWidth={2.1} />
				</HudMagneticButton>
			</Tooltip>
		</div>
	);
});

export const HudStudioButton = memo(function HudStudioButton({
	disabled,
	label,
	onClick,
}: {
	disabled: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip content={label}>
			<button
				data-testid="launch-open-studio-button"
				disabled={disabled}
				className={`${hudIconBtnClasses} ${disabled ? "opacity-30 cursor-not-allowed pointer-events-none" : ""}`}
				onClick={onClick}
			>
				<OpenInEditorIcon />
			</button>
		</Tooltip>
	);
});

export const HudNotesButton = memo(function HudNotesButton({
	disabled,
	label,
	onClick,
}: {
	disabled: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip content={label}>
			<button
				type="button"
				aria-label={label}
				disabled={disabled}
				className={`${hudIconBtnClasses} ${disabled ? "opacity-30 cursor-not-allowed pointer-events-none" : ""}`}
				onClick={onClick}
			>
				<NotepadText size={ICON_SIZE} />
			</button>
		</Tooltip>
	);
});

export const HudRecordingControls = memo(function HudRecordingControls({
	vertical,
	paused,
	saving,
	canPause,
	pauseLabel,
	restartLabel,
	cancelLabel,
	onTogglePause,
	onRestart,
	onCancel,
}: {
	vertical: boolean;
	paused: boolean;
	saving: boolean;
	canPause: boolean;
	pauseLabel: string;
	restartLabel: string;
	cancelLabel: string;
	onTogglePause: () => void;
	onRestart: () => void;
	onCancel: () => void;
}) {
	return (
		<div
			className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""} ${styles.electronNoDrag}`}
		>
			{canPause && (
				<Tooltip content={pauseLabel}>
					<button className={hudAuxIconBtnClasses} onClick={onTogglePause} disabled={saving}>
						{getIcon(paused ? "resume" : "pause", paused ? "text-amber-400" : "text-white/60")}
					</button>
				</Tooltip>
			)}
			<Tooltip content={restartLabel}>
				<button className={hudAuxIconBtnClasses} onClick={onRestart} disabled={saving}>
					{getIcon("restart", "text-white/60")}
				</button>
			</Tooltip>
			<Tooltip content={cancelLabel}>
				<button className={hudAuxIconBtnClasses} onClick={onCancel} disabled={saving}>
					{getIcon("cancel", "text-white/60")}
				</button>
			</Tooltip>
		</div>
	);
});

export const HudLanguageButton = memo(function HudLanguageButton({
	vertical,
	code,
	label,
	disabled,
	expanded,
	onClick,
	buttonRef,
}: {
	vertical: boolean;
	code: string;
	label: string;
	disabled: boolean;
	expanded: boolean;
	onClick: () => void;
	buttonRef: React.MutableRefObject<HTMLButtonElement | null>;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			aria-label={label}
			aria-expanded={expanded}
			aria-haspopup="menu"
			data-hud-popover-trigger="true"
			disabled={disabled}
			onClick={onClick}
			title={label}
			className={`flex h-[34px] items-center rounded-[10px] border-0 bg-transparent text-[#828c99] transition-all duration-150 hover:bg-[#1a1e25] hover:text-[#e9edf3] ${
				vertical ? "w-[34px] justify-center px-0" : "gap-1.5 px-2.5"
			} ${styles.electronNoDrag} ${disabled ? "opacity-30 cursor-not-allowed pointer-events-none" : ""}`}
		>
			<Languages size={16} className="shrink-0" />
			<span
				className={`${vertical ? "sr-only" : ""} font-mono text-[11px] font-semibold tracking-wide text-[#f5f7fa]`}
			>
				{code}
			</span>
		</button>
	);
});

export const HudWindowControls = memo(function HudWindowControls({
	vertical,
	disabled,
	closeDisabled,
	hideLabel,
	closeLabel,
	onHide,
	onClose,
}: {
	vertical: boolean;
	disabled: boolean;
	closeDisabled: boolean;
	hideLabel: string;
	closeLabel: string;
	onHide: () => void;
	onClose: () => void;
}) {
	return (
		<div className={`flex items-center gap-[5px] ${vertical ? "flex-col" : ""}`}>
			<button className={windowBtnClasses} title={hideLabel} onClick={onHide} disabled={disabled}>
				{getIcon("minimize")}
			</button>
			<button
				className={closeBtnClasses}
				title={closeLabel}
				onClick={onClose}
				disabled={closeDisabled}
			>
				{getIcon("close")}
			</button>
		</div>
	);
});

export const HudLanguageMenu = memo(function HudLanguageMenu({
	locales,
	activeLocale,
	getName,
	onSelect,
	panelRef,
	onEnsureInteractive,
}: {
	locales: readonly string[];
	activeLocale: string;
	getName: (locale: string) => string;
	onSelect: (locale: string) => void;
	panelRef: (el: HTMLDivElement | null) => void;
	onEnsureInteractive: () => void;
}) {
	return (
		<div
			ref={panelRef}
			data-hud-interactive="true"
			data-testid="hud-language-menu"
			role="menu"
			className={`${styles.hudPopover} ${styles.hudPopoverScroll} ${styles.hudScrollbar} animate-mic-panel-in ${styles.electronNoDrag}`}
			onPointerDown={(event) => event.stopPropagation()}
			onPointerEnter={onEnsureInteractive}
			onWheel={(event) => {
				onEnsureInteractive();
				event.stopPropagation();
			}}
		>
			{locales.map((loc) => (
				<button
					key={loc}
					type="button"
					role="menuitemradio"
					aria-checked={loc === activeLocale}
					onClick={() => onSelect(loc)}
					className={`${styles.languageMenuItem} ${loc === activeLocale ? styles.languageMenuItemActive : ""}`}
				>
					<span className="truncate">{getName(loc)}</span>
					{loc === activeLocale ? <Check size={11} className="text-white/85" /> : null}
				</button>
			))}
		</div>
	);
});

export const HudActionMenu = memo(function HudActionMenu({
	deviceSettingsLabel,
	cursorLabel,
	studioLabel,
	notesLabel,
	layoutLabel,
	languageLabel,
	languageCode,
	showCursor,
	showNotes,
	onDeviceSettings,
	onCursor,
	onStudio,
	onNotes,
	onLayout,
	onLanguage,
	panelRef,
	onEnsureInteractive,
}: {
	deviceSettingsLabel: string;
	cursorLabel: string;
	studioLabel: string;
	notesLabel: string;
	layoutLabel: string;
	languageLabel: string;
	languageCode: string;
	showCursor: boolean;
	showNotes: boolean;
	onDeviceSettings: () => void;
	onCursor: () => void;
	onStudio: () => void;
	onNotes: () => void;
	onLayout: () => void;
	onLanguage: () => void;
	panelRef: (el: HTMLDivElement | null) => void;
	onEnsureInteractive: () => void;
}) {
	const actions = [
		{ key: "devices", label: deviceSettingsLabel, icon: Settings, onClick: onDeviceSettings },
		...(showCursor
			? [{ key: "cursor", label: cursorLabel, icon: MousePointer2, onClick: onCursor }]
			: []),
		{ key: "studio", label: studioLabel, icon: Clapperboard, onClick: onStudio },
		...(showNotes
			? [{ key: "notes", label: notesLabel, icon: NotepadText, onClick: onNotes }]
			: []),
		{ key: "layout", label: layoutLabel, icon: Monitor, onClick: onLayout },
	];

	return (
		<div
			ref={panelRef}
			data-hud-interactive="true"
			data-testid="hud-action-menu"
			role="menu"
			className={`${styles.hudPopover} ${styles.electronNoDrag}`}
			onPointerDown={(event) => event.stopPropagation()}
			onPointerEnter={onEnsureInteractive}
		>
			{actions.map(({ key, label, icon: Icon, onClick }) => (
				<button
					key={key}
					type="button"
					role="menuitem"
					onClick={onClick}
					className={styles.hudActionMenuItem}
				>
					<Icon size={16} strokeWidth={1.8} />
					<span className="truncate">{label}</span>
				</button>
			))}
			<button
				type="button"
				role="menuitem"
				onClick={onLanguage}
				className={styles.hudActionMenuItem}
			>
				<Languages size={16} strokeWidth={1.8} />
				<span className="flex-1 truncate text-left">{languageLabel}</span>
				<span className="font-mono text-[10px] font-semibold text-white/55">{languageCode}</span>
			</button>
		</div>
	);
});

export const HudNotice = memo(function HudNotice({
	title,
	description,
	dismissLabel,
	confirmLabel,
	onDismiss,
	onConfirm,
}: {
	title: string;
	description: string;
	dismissLabel: string;
	confirmLabel: string;
	onDismiss: () => void;
	onConfirm: () => void;
}) {
	return (
		<div
			data-hud-interactive="true"
			className={`w-full rounded-xl border border-white/15 bg-[rgba(20,20,28,0.95)] p-3 shadow-2xl backdrop-blur-xl text-white animate-in fade-in-0 zoom-in-95 duration-200 ${styles.electronNoDrag}`}
		>
			<div className="text-[13px] font-semibold text-white">{title}</div>
			<div className="mt-1 text-[11px] leading-relaxed text-white/75">{description}</div>
			<div className="mt-3 flex items-center justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onDismiss}
					className="h-7 text-xs text-white/80 hover:bg-white/10 hover:text-white"
				>
					{dismissLabel}
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={onConfirm}
					className="h-7 text-xs bg-white text-[#10121b] hover:bg-white/90"
				>
					{confirmLabel}
				</Button>
			</div>
		</div>
	);
});
