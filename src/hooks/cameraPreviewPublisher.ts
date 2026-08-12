// The OS window is 280 CSS px wide, but it can sit on a Retina/HiDPI display.
// Keep roughly two physical pixels per CSS pixel and avoid the visibly soft
// 320 px / low-quality JPEG pipeline this replaces.
const PREVIEW_WIDTH = 640;
const PREVIEW_FPS = 24;
const WEBP_QUALITY = 0.95;

export interface CameraPreviewPublisher {
	stop: () => void;
}

/**
 * Fans a small, throttled self-view out of the recorder's existing MediaStream.
 * It never opens the camera itself, so the recording and preview cannot fight
 * for an exclusive device claim.
 */
export function publishCameraPreview(stream: MediaStream): CameraPreviewPublisher {
	if (!window.electronAPI?.publishRendererCameraPreviewFrame) {
		return { stop: () => undefined };
	}

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.srcObject = stream;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	let stopped = false;
	let timer: number | null = null;
	let encoding = false;

	const capture = () => {
		if (stopped || !context || video.videoWidth <= 0 || video.videoHeight <= 0 || encoding) return;
		const width = Math.min(PREVIEW_WIDTH, video.videoWidth);
		const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		context.drawImage(video, 0, 0, width, height);
		encoding = true;
		canvas.toBlob(
			(blob) => {
				if (stopped || !blob) {
					encoding = false;
					return;
				}
				void blob
					.arrayBuffer()
					.then((data) =>
						window.electronAPI?.publishRendererCameraPreviewFrame?.({
							mimeType: "image/webp",
							data,
						}),
					)
					.finally(() => {
						encoding = false;
					});
			},
			"image/webp",
			WEBP_QUALITY,
		);
	};

	void video
		.play()
		.then(() => {
			if (stopped) return;
			capture();
			timer = window.setInterval(capture, Math.round(1000 / PREVIEW_FPS));
		})
		.catch((error) => console.warn("Failed to start the camera preview publisher:", error));

	return {
		stop: () => {
			if (stopped) return;
			stopped = true;
			if (timer !== null) window.clearInterval(timer);
			video.pause();
			video.srcObject = null;
		},
	};
}
