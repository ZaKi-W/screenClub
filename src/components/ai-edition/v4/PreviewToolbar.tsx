import { Battery, Check, ChevronDown, Crop, Gauge, PanelsTopLeft, Sparkles } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import {
	type PreviewPerformanceMode,
	usePreviewPerformanceStore,
} from "@/lib/ai-edition/store/previewPerformance";
import { useEditorSettings } from "@/lib/ai-edition/store/useEditorSettings";
import {
	ASPECT_RATIO_PRESETS,
	type AspectRatio,
	type AspectRatioPreset,
	getAspectRatioLabel,
	parseAspectRatio,
} from "@/utils/aspectRatioUtils";
import styles from "./EditorShellV4.module.css";

const PRESET_LABEL_KEYS: Record<AspectRatioPreset, string> = {
	"16:9": "aspectRatio.wide",
	"1:1": "aspectRatio.square",
	"4:3": "aspectRatio.classic",
	"9:16": "aspectRatio.vertical",
	"3:4": "aspectRatio.tall",
	"4:5": "aspectRatio.portrait",
};

function RatioGlyph({ ratio }: { ratio: AspectRatio }) {
	const parsed = ratio === "native" ? null : parseAspectRatio(ratio);
	const value = parsed ? parsed.width / parsed.height : 16 / 10;
	const width = value >= 1 ? 18 : Math.max(7, Math.round(18 * value));
	const height = value >= 1 ? Math.max(7, Math.round(18 / value)) : 18;

	return (
		<span className={styles.aspectRatioGlyph} aria-hidden>
			<span style={{ width, height }} />
		</span>
	);
}

export function PreviewToolbar({ canCrop, onCrop }: { canCrop: boolean; onCrop: () => void }) {
	const t = useScopedT("editor");
	const { settings, hasDocument, set: setSettings } = useEditorSettings();
	const [open, setOpen] = useState(false);
	const [performanceOpen, setPerformanceOpen] = useState(false);
	const previewMode = usePreviewPerformanceStore((state) => state.mode);
	const setPreviewMode = usePreviewPerformanceStore((state) => state.setMode);
	const selected = settings.aspectRatio;
	const selectedLabel =
		selected === "native"
			? t("aspectRatio.auto")
			: selected in PRESET_LABEL_KEYS
				? t(PRESET_LABEL_KEYS[selected as AspectRatioPreset])
				: getAspectRatioLabel(selected);

	const selectRatio = (ratio: AspectRatio) => {
		void setSettings({ aspectRatio: ratio });
		setOpen(false);
	};
	const performanceOptions: Array<{
		mode: PreviewPerformanceMode;
		label: string;
		description: string;
		icon: typeof Sparkles;
	}> = [
		{
			mode: "quality",
			label: "Quality",
			description: "Native full-fidelity preview",
			icon: Sparkles,
		},
		{
			mode: "performance",
			label: "Performance",
			description: "Smooth direct preview · 30 fps UI",
			icon: Gauge,
		},
		{
			mode: "power-saving",
			label: "Power Saving",
			description: "Smooth preview · reduced UI updates",
			icon: Battery,
		},
	];
	const activePerformance =
		performanceOptions.find((option) => option.mode === previewMode) ?? performanceOptions[1];
	const ActivePerformanceIcon = activePerformance.icon;

	return (
		<div className={styles.stageToolbar} role="toolbar" aria-label={t("shell.previewStage")}>
			<div className={styles.stageToolbarActions}>
				<Popover open={performanceOpen} onOpenChange={setPerformanceOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className={styles.stageToolbarButton}
							title="Preview performance"
							aria-label="Preview performance"
						>
							<ActivePerformanceIcon size={15} aria-hidden />
							<span>{activePerformance.label}</span>
							<ChevronDown size={12} aria-hidden />
						</button>
					</PopoverTrigger>
					<PopoverContent
						align="center"
						sideOffset={7}
						animated={false}
						className="w-auto border-0 bg-transparent p-0 shadow-none"
					>
						<div className={styles.previewPerformanceMenu} role="menu">
							{performanceOptions.map((option) => {
								const Icon = option.icon;
								return (
									<button
										type="button"
										key={option.mode}
										className={styles.previewPerformanceOption}
										aria-checked={previewMode === option.mode}
										role="menuitemradio"
										onClick={() => {
											setPreviewMode(option.mode);
											setPerformanceOpen(false);
										}}
									>
										<Icon size={16} aria-hidden />
										<span>
											<strong>{option.label}</strong>
											<small>{option.description}</small>
										</span>
										{previewMode === option.mode ? <Check size={15} aria-hidden /> : null}
									</button>
								);
							})}
						</div>
					</PopoverContent>
				</Popover>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className={styles.stageToolbarButton}
							disabled={!hasDocument}
							title={t("aspectRatio.label")}
							aria-label={t("aspectRatio.label")}
						>
							<PanelsTopLeft size={15} aria-hidden />
							<span>{selectedLabel}</span>
							<ChevronDown size={12} aria-hidden />
						</button>
					</PopoverTrigger>
					<PopoverContent
						align="center"
						sideOffset={7}
						animated={false}
						className="w-auto border-0 bg-transparent p-0 shadow-none"
					>
						<div className={styles.aspectRatioMenu}>
							<button
								type="button"
								className={styles.aspectRatioOption}
								aria-checked={selected === "native"}
								role="menuitemradio"
								onClick={() => selectRatio("native")}
							>
								<RatioGlyph ratio="native" />
								<span>{t("aspectRatio.auto")}</span>
								{selected === "native" ? <Check size={15} aria-hidden /> : null}
							</button>
							{ASPECT_RATIO_PRESETS.map((ratio) => (
								<button
									type="button"
									key={ratio}
									className={styles.aspectRatioOption}
									aria-checked={selected === ratio}
									role="menuitemradio"
									onClick={() => selectRatio(ratio)}
								>
									<RatioGlyph ratio={ratio} />
									<span>{t(PRESET_LABEL_KEYS[ratio])}</span>
									{selected === ratio ? <Check size={15} aria-hidden /> : null}
								</button>
							))}
						</div>
					</PopoverContent>
				</Popover>
				<button
					type="button"
					className={styles.stageToolbarButton}
					disabled={!canCrop}
					title={t("aspectRatio.crop")}
					aria-label={t("aspectRatio.crop")}
					onClick={onCrop}
				>
					<Crop size={15} aria-hidden />
					<span>{t("aspectRatio.crop")}</span>
				</button>
			</div>
		</div>
	);
}
