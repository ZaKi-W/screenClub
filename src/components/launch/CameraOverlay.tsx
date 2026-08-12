import { Camera, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import {
	decodeBgraFrame,
	type NativeCameraPreviewFrame,
	type RendererCameraPreviewFrame,
} from "@/lib/cameraOverlay";
import styles from "./CameraOverlay.module.css";

function DirectCameraPreview({ deviceId }: { deviceId: string | null }) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [hasFrame, setHasFrame] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let stream: MediaStream | null = null;
		void navigator.mediaDevices
			.getUserMedia({
				audio: false,
				video: {
					...(deviceId ? { deviceId: { exact: deviceId } } : {}),
					width: { ideal: 1920 },
					height: { ideal: 1080 },
					frameRate: { ideal: 60, min: 30 },
				},
			})
			.then(async (nextStream) => {
				if (cancelled) {
					nextStream.getTracks().forEach((track) => track.stop());
					return;
				}
				stream = nextStream;
				const video = videoRef.current;
				if (!video) return;
				video.srcObject = nextStream;
				await video.play();
				if (!cancelled) setHasFrame(true);
			})
			.catch((error) => console.warn("Failed to start direct camera preview:", error));

		return () => {
			cancelled = true;
			stream?.getTracks().forEach((track) => track.stop());
			if (videoRef.current) videoRef.current.srcObject = null;
		};
	}, [deviceId]);

	return (
		<>
			{!hasFrame ? (
				<div className={styles.fallback}>
					<Camera size={28} />
				</div>
			) : null}
			<video
				ref={videoRef}
				className={styles.preview}
				hidden={!hasFrame}
				autoPlay
				muted
				playsInline
			/>
		</>
	);
}

function BridgedCameraPreview({ nativePreview }: { nativePreview: boolean }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [hasFrame, setHasFrame] = useState(false);

	useEffect(() => {
		if (nativePreview) {
			return window.electronAPI?.onNativeCameraPreviewFrame?.((frame: NativeCameraPreviewFrame) => {
				const rgba = decodeBgraFrame(frame);
				const canvas = canvasRef.current;
				if (!rgba || !canvas) return;
				canvas.width = frame.width;
				canvas.height = frame.height;
				const context = canvas.getContext("2d");
				if (!context) return;
				context.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
				setHasFrame(true);
			});
		}

		let previousUrl: string | null = null;
		const cleanup = window.electronAPI?.onRendererCameraPreviewFrame?.(
			(frame: RendererCameraPreviewFrame) => {
				const image = imageRef.current;
				if (!image || frame.mimeType !== "image/webp" || frame.data.byteLength > 2_000_000) return;
				const nextUrl = URL.createObjectURL(new Blob([frame.data], { type: frame.mimeType }));
				image.src = nextUrl;
				if (previousUrl) URL.revokeObjectURL(previousUrl);
				previousUrl = nextUrl;
				setHasFrame(true);
			},
		);
		return () => {
			cleanup?.();
			if (previousUrl) URL.revokeObjectURL(previousUrl);
		};
	}, [nativePreview]);

	return (
		<>
			{!hasFrame ? (
				<div className={styles.fallback}>
					<Camera size={28} />
				</div>
			) : null}
			{nativePreview ? (
				<canvas ref={canvasRef} className={styles.preview} hidden={!hasFrame} />
			) : (
				<img ref={imageRef} className={styles.preview} hidden={!hasFrame} alt="" />
			)}
		</>
	);
}

export function CameraOverlay() {
	const t = useScopedT("launch");
	const params = new URLSearchParams(window.location.search);
	const previewSource = params.get("previewSource");

	return (
		<div className={styles.root} data-testid="camera-overlay">
			<div className={styles.frame}>
				{previewSource === "direct" ? (
					<DirectCameraPreview deviceId={params.get("deviceId")} />
				) : (
					<BridgedCameraPreview nativePreview={previewSource === "native"} />
				)}
				<button
					type="button"
					className={styles.hideButton}
					aria-label={t("webcam.hidePreview")}
					title={t("webcam.hidePreview")}
					onClick={() => window.electronAPI?.hideCameraOverlay?.()}
				>
					<EyeOff size={15} />
				</button>
			</div>
		</div>
	);
}
