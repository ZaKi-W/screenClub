export type CameraOverlayCaptureBackend = "native-mac" | "native-windows" | "browser";

export interface CameraOverlayPrepareRequest {
	deviceId?: string;
	deviceName?: string;
	captureBackend: CameraOverlayCaptureBackend;
}

export interface NativeCameraPreviewFrame {
	width: number;
	height: number;
	bgraBase64: string;
}

export interface RendererCameraPreviewFrame {
	mimeType: "image/webp";
	data: ArrayBuffer;
}

export function isNativeCameraPreviewFrame(value: unknown): value is NativeCameraPreviewFrame {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<NativeCameraPreviewFrame>;
	const expectedBase64Length =
		typeof candidate.width === "number" && typeof candidate.height === "number"
			? Math.ceil((candidate.width * candidate.height * 4) / 3) * 4
			: 0;
	return (
		typeof candidate.width === "number" &&
		Number.isInteger(candidate.width) &&
		candidate.width > 0 &&
		candidate.width <= 640 &&
		typeof candidate.height === "number" &&
		Number.isInteger(candidate.height) &&
		candidate.height > 0 &&
		candidate.height <= 640 &&
		typeof candidate.bgraBase64 === "string" &&
		candidate.bgraBase64.length === expectedBase64Length
	);
}

export function decodeBgraFrame(
	frame: NativeCameraPreviewFrame,
): Uint8ClampedArray<ArrayBuffer> | null {
	let binary: string;
	try {
		binary = atob(frame.bgraBase64);
	} catch {
		return null;
	}

	const expectedLength = frame.width * frame.height * 4;
	if (binary.length !== expectedLength) return null;

	const rgba = new Uint8ClampedArray(new ArrayBuffer(expectedLength));
	for (let offset = 0; offset < expectedLength; offset += 4) {
		rgba[offset] = binary.charCodeAt(offset + 2);
		rgba[offset + 1] = binary.charCodeAt(offset + 1);
		rgba[offset + 2] = binary.charCodeAt(offset);
		rgba[offset + 3] = 255;
	}
	return rgba;
}
