import type { ExportCompressionPreset, ExportQuality, ExportResolution } from "./types";

export interface Mp4ExportSettings {
	width: number;
	height: number;
	bitrate: number;
}

interface SourceCropRegion {
	width: number;
	height: number;
}

interface Dims {
	width: number;
	height: number;
}

/**
 * Would rendering a `source`-sized clip into an `output`-sized frame stretch it past its own
 * resolution?
 *
 * The clip is CONTAIN-fitted into the output frame, so the answer is that fit scale — not a
 * comparison of short sides, which counts letterbox rows as if they were stretched pixels. A
 * 1920x1032 window capture in a 16:9 project gives a 1920x1080 frame whose 48 extra rows are
 * wallpaper, at scale 1.0: nothing is upscaled. The short-side test called that frame an
 * upscale under the "1080p" tier while "Source" produced the exact same frame unflagged.
 */
export function wouldUpscale(output: Dims, source: Dims): boolean {
	return Math.min(output.width / source.width, output.height / source.height) > 1;
}

const MEDIUM_SHORT_SIDE = 720;
const HIGH_SHORT_SIDE = 1080;
const FOUR_K_SHORT_SIDE = 2160;

function even(value: number) {
	return Math.floor(value / 2) * 2;
}

function atLeastEven(value: number) {
	return Math.max(2, even(value));
}

export function calculateEffectiveSourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	cropRegion?: SourceCropRegion,
) {
	const cropWidth = cropRegion?.width ?? 1;
	const cropHeight = cropRegion?.height ?? 1;

	return {
		width: atLeastEven(Math.round(sourceWidth * cropWidth)),
		height: atLeastEven(Math.round(sourceHeight * cropHeight)),
	};
}

function calculateDimensionsForShortSide(targetShortSide: number, aspectRatioValue: number) {
	if (aspectRatioValue >= 1) {
		const height = even(targetShortSide);
		return {
			width: even(height * aspectRatioValue),
			height,
		};
	}

	const width = even(targetShortSide);
	return {
		width,
		height: even(width / aspectRatioValue),
	};
}

function calculateSourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatioValue: number,
) {
	const sourceLongDim = Math.max(sourceWidth, sourceHeight);

	if (aspectRatioValue === 1) {
		const baseDimension = even(Math.min(sourceWidth, sourceHeight));
		return {
			width: baseDimension,
			height: baseDimension,
		};
	}

	if (aspectRatioValue > 1) {
		const baseWidth = even(sourceLongDim);
		for (let width = baseWidth; width >= 100; width -= 2) {
			const height = Math.round(width / aspectRatioValue);
			if (height % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
				return { width, height };
			}
		}
		return {
			width: baseWidth,
			height: even(baseWidth / aspectRatioValue),
		};
	}

	const baseHeight = even(sourceLongDim);
	for (let height = baseHeight; height >= 100; height -= 2) {
		const width = Math.round(height * aspectRatioValue);
		if (width % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
			return { width, height };
		}
	}
	return {
		width: even(baseHeight * aspectRatioValue),
		height: baseHeight,
	};
}

function calculateBitrate(width: number, height: number, quality: ExportQuality) {
	const totalPixels = width * height;

	if (quality === "source") {
		if (totalPixels > 2560 * 1440) return 80_000_000;
		if (totalPixels > 1920 * 1080) return 50_000_000;
		return 30_000_000;
	}

	if (totalPixels <= 1280 * 720) return 10_000_000;
	if (totalPixels <= 1920 * 1080) return 20_000_000;
	return 30_000_000;
}

const COMPRESSION_BASE_BITRATE_1080P_60: Record<ExportCompressionPreset, number> = {
	studio: 30_000_000,
	social: 20_000_000,
	web: 12_000_000,
	"web-low": 8_000_000,
};

/**
 * Resolution and compression are deliberately independent: choosing 4K changes
 * the raster size, while the purpose preset changes only the encoder budget.
 */
export function calculatePresetMp4ExportSettings({
	resolution,
	compression,
	fps,
	aspectRatioValue,
}: {
	resolution: ExportResolution;
	compression: ExportCompressionPreset;
	fps: 24 | 30 | 60;
	aspectRatioValue: number;
}): Mp4ExportSettings {
	const shortSide =
		resolution === "720p"
			? MEDIUM_SHORT_SIDE
			: resolution === "1080p"
				? HIGH_SHORT_SIDE
				: FOUR_K_SHORT_SIDE;
	const dimensions = calculateDimensionsForShortSide(shortSide, aspectRatioValue);
	const pixelScale = (dimensions.width * dimensions.height) / (1920 * 1080);
	const frameRateScale = fps === 60 ? 1 : fps === 30 ? 0.75 : 0.65;
	const bitrate = Math.max(
		2_000_000,
		Math.round(
			(COMPRESSION_BASE_BITRATE_1080P_60[compression] * pixelScale * frameRateScale) / 100_000,
		) * 100_000,
	);

	return { ...dimensions, bitrate };
}

export function calculateMp4ExportSettings({
	quality,
	sourceWidth,
	sourceHeight,
	aspectRatioValue,
}: {
	quality: ExportQuality;
	sourceWidth: number;
	sourceHeight: number;
	aspectRatioValue: number;
}): Mp4ExportSettings {
	if (quality === "medium") {
		const dimensions = calculateDimensionsForShortSide(MEDIUM_SHORT_SIDE, aspectRatioValue);
		return {
			...dimensions,
			bitrate: calculateBitrate(dimensions.width, dimensions.height, quality),
		};
	}

	if (quality === "good") {
		const dimensions = calculateDimensionsForShortSide(HIGH_SHORT_SIDE, aspectRatioValue);
		return {
			...dimensions,
			bitrate: calculateBitrate(dimensions.width, dimensions.height, quality),
		};
	}

	const sourceDimensions = calculateSourceDimensions(sourceWidth, sourceHeight, aspectRatioValue);
	return {
		...sourceDimensions,
		bitrate: calculateBitrate(sourceDimensions.width, sourceDimensions.height, quality),
	};
}
