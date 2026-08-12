// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { publishCameraPreview } from "./cameraPreviewPublisher";

describe("publishCameraPreview", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("publishes a high-resolution WebP self-view from the existing stream", async () => {
		vi.useFakeTimers();
		const publish = vi.fn();
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { publishRendererCameraPreviewFrame: publish },
		});

		const context = { drawImage: vi.fn() };
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as CanvasRenderingContext2D,
		);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
			expect(type).toBe("image/webp");
			callback(new Blob(["preview"], { type: "image/webp" }));
		});
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
		vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1920);
		vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(1080);

		const publisher = publishCameraPreview({} as MediaStream);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();

		expect(context.drawImage).toHaveBeenCalledWith(expect.any(HTMLVideoElement), 0, 0, 640, 360);
		expect(publish).toHaveBeenCalledWith({
			mimeType: "image/webp",
			data: expect.any(ArrayBuffer),
		});

		publisher.stop();
	});
});
