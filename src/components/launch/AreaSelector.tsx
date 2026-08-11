import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { CaptureAreaRect } from "@/lib/captureArea";

const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;

type Gesture =
	| { type: "draw"; startX: number; startY: number }
	| { type: "move"; startX: number; startY: number; initial: CaptureAreaRect }
	| {
			type: "resize";
			horizontal: "left" | "right";
			vertical: "top" | "bottom";
			startX: number;
			startY: number;
			initial: CaptureAreaRect;
	  };

function initialRect(): CaptureAreaRect {
	const width = Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.62));
	const height = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.58));
	return {
		x: Math.round((window.innerWidth - width) / 2),
		y: Math.round((window.innerHeight - height) / 2),
		width,
		height,
	};
}

function clampRect(rect: CaptureAreaRect): CaptureAreaRect {
	const width = Math.min(window.innerWidth, Math.max(MIN_WIDTH, rect.width));
	const height = Math.min(window.innerHeight, Math.max(MIN_HEIGHT, rect.height));
	return {
		x: Math.max(0, Math.min(window.innerWidth - width, rect.x)),
		y: Math.max(0, Math.min(window.innerHeight - height, rect.y)),
		width,
		height,
	};
}

export function AreaSelector() {
	const commonT = useScopedT("common");
	const [rect, setRect] = useState<CaptureAreaRect>(initialRect);
	const gestureRef = useRef<Gesture | null>(null);
	const displayId = Number(new URLSearchParams(window.location.search).get("displayId"));

	const finish = useCallback(() => {
		if (!Number.isFinite(displayId)) return;
		void window.electronAPI.confirmAreaSelection({
			displayId,
			rect: {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			},
		});
	}, [displayId, rect]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") window.electronAPI.cancelAreaSelection();
			if (event.key === "Enter") finish();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [finish]);

	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const gesture = gestureRef.current;
		if (!gesture) return;
		if (gesture.type === "draw") {
			const x = Math.min(gesture.startX, event.clientX);
			const y = Math.min(gesture.startY, event.clientY);
			setRect(
				clampRect({
					x,
					y,
					width: Math.abs(event.clientX - gesture.startX),
					height: Math.abs(event.clientY - gesture.startY),
				}),
			);
			return;
		}
		const deltaX = event.clientX - gesture.startX;
		const deltaY = event.clientY - gesture.startY;
		if (gesture.type === "move") {
			setRect(
				clampRect({
					...gesture.initial,
					x: gesture.initial.x + deltaX,
					y: gesture.initial.y + deltaY,
				}),
			);
			return;
		}

		let left = gesture.initial.x;
		let top = gesture.initial.y;
		let right = gesture.initial.x + gesture.initial.width;
		let bottom = gesture.initial.y + gesture.initial.height;
		if (gesture.horizontal === "left") left = Math.min(right - MIN_WIDTH, left + deltaX);
		else right = Math.max(left + MIN_WIDTH, right + deltaX);
		if (gesture.vertical === "top") top = Math.min(bottom - MIN_HEIGHT, top + deltaY);
		else bottom = Math.max(top + MIN_HEIGHT, bottom + deltaY);
		left = Math.max(0, left);
		top = Math.max(0, top);
		right = Math.min(window.innerWidth, right);
		bottom = Math.min(window.innerHeight, bottom);
		setRect({ x: left, y: top, width: right - left, height: bottom - top });
	};

	const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
		gestureRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	const beginGesture = (event: React.PointerEvent<HTMLElement>, gesture: Gesture) => {
		event.preventDefault();
		event.stopPropagation();
		gestureRef.current = gesture;
		(event.currentTarget.closest("[data-area-root]") as HTMLElement | null)?.setPointerCapture(
			event.pointerId,
		);
	};

	const handles = [
		["left", "top", "-translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
		["right", "top", "translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
		["left", "bottom", "-translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
		["right", "bottom", "translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
	] as const;

	return (
		<div
			data-area-root
			className="relative h-screen w-screen cursor-crosshair select-none overflow-hidden bg-transparent"
			onPointerDown={(event) => {
				if (event.target !== event.currentTarget) return;
				beginGesture(event, {
					type: "draw",
					startX: event.clientX,
					startY: event.clientY,
				});
			}}
			onPointerMove={onPointerMove}
			onPointerUp={endGesture}
			onPointerCancel={endGesture}
		>
			<div
				className="absolute cursor-move border border-white/85 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.58),0_0_0_1px_rgba(0,0,0,0.75)]"
				style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
				onPointerDown={(event) =>
					beginGesture(event, {
						type: "move",
						startX: event.clientX,
						startY: event.clientY,
						initial: rect,
					})
				}
			>
				<div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
					{Array.from({ length: 9 }).map((_, index) => (
						<span key={index} className="border border-white/[0.08]" />
					))}
				</div>
				{handles.map(([horizontal, vertical, className]) => (
					<button
						key={`${horizontal}-${vertical}`}
						type="button"
						aria-label={commonT("recordingSource.area")}
						className={`absolute h-3.5 w-3.5 rounded-full border-2 border-[#242424] bg-white ${className}`}
						style={{
							left: horizontal === "left" ? 0 : "100%",
							top: vertical === "top" ? 0 : "100%",
						}}
						onPointerDown={(event) =>
							beginGesture(event, {
								type: "resize",
								horizontal,
								vertical,
								startX: event.clientX,
								startY: event.clientY,
								initial: rect,
							})
						}
					/>
				))}
			</div>

			<div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-xl border border-white/15 bg-[#202020]/95 px-4 py-2 text-[13px] font-medium text-white shadow-2xl backdrop-blur-xl">
				{commonT("recordingSource.area")}
			</div>
			<div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/15 bg-[#202020]/95 p-2 shadow-2xl backdrop-blur-xl">
				<span className="px-2 text-[13px] font-medium tabular-nums text-white/75">
					{Math.round(rect.width)} × {Math.round(rect.height)} px
				</span>
				<button
					type="button"
					className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-white/75 hover:bg-white/10 hover:text-white"
					onClick={() => window.electronAPI.cancelAreaSelection()}
				>
					<X size={16} /> {commonT("actions.cancel")}
				</button>
				<button
					type="button"
					className="flex h-9 items-center gap-1.5 rounded-xl bg-[#10b981] px-4 text-[13px] font-semibold text-[#07130f] hover:bg-[#21c991]"
					onClick={finish}
				>
					<Check size={16} /> {commonT("actions.done")}
				</button>
			</div>
		</div>
	);
}
