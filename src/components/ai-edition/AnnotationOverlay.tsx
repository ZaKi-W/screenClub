// DOM annotation pixels plus their editing chrome. `react-rnd` owns the live
// drag/resize rectangle; the project document receives one final patch on
// release, so pointer frames never rebuild the editor root.

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { AxcutAnnotationRegion } from "@/lib/ai-edition/schema";
import { cn } from "@/lib/utils";

interface AnnotationOverlayProps {
	annotation: AxcutAnnotationRegion;
	isSelected: boolean;
	containerWidth: number;
	containerHeight: number;
	onPositionChange: (id: string, position: { x: number; y: number }) => void;
	onRectChange: (
		id: string,
		patch: {
			position: { x: number; y: number };
			size: { width: number; height: number };
		},
	) => void;
	/** Persist the final patch once after a completed drag/resize. */
	onCommit?: () => void;
	onClick: (id: string) => void;
	zIndex: number;
	isSelectedBoost: boolean;
	renderContent: boolean;
}

const ARROW_ROTATION: Record<string, number> = {
	right: 0,
	"down-right": 45,
	down: 90,
	"down-left": 135,
	left: 180,
	"up-left": 225,
	up: 270,
	"up-right": 315,
};

function AnnotationPixels({
	annotation,
	containerHeight,
}: {
	annotation: AxcutAnnotationRegion;
	containerHeight: number;
}) {
	const base: CSSProperties = {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		pointerEvents: "none",
	};
	if (annotation.type === "text") {
		return (
			<div
				style={{
					...base,
					display: "flex",
					alignItems: "center",
					justifyContent:
						annotation.style.textAlign === "left"
							? "flex-start"
							: annotation.style.textAlign === "right"
								? "flex-end"
								: "center",
					padding: "0.18em 0.32em",
					boxSizing: "border-box",
					color: annotation.style.color,
					background: annotation.style.backgroundColor,
					fontFamily: annotation.style.fontFamily,
					fontSize: Math.max(8, (annotation.style.fontSize / 1080) * containerHeight),
					fontWeight: annotation.style.fontWeight,
					fontStyle: annotation.style.fontStyle,
					textDecoration: annotation.style.textDecoration,
					textAlign: annotation.style.textAlign,
					whiteSpace: "pre-wrap",
					overflow: "hidden",
				}}
			>
				{annotation.content}
			</div>
		);
	}
	if (annotation.type === "image") {
		return annotation.content ? (
			<img alt="" aria-hidden src={annotation.content} style={{ ...base, objectFit: "contain" }} />
		) : null;
	}
	if (annotation.type === "figure") {
		const figure = annotation.figureData;
		const color = figure?.color ?? "#27E0C1";
		const strokeWidth = Math.max(1, figure?.strokeWidth ?? 4);
		return (
			<svg
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				aria-hidden
				style={{
					...base,
					transform: `rotate(${ARROW_ROTATION[figure?.arrowDirection ?? "right"] ?? 0}deg)`,
				}}
			>
				<line
					x1="10"
					y1="50"
					x2="82"
					y2="50"
					stroke={color}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
				/>
				<polyline
					points="66,30 86,50 66,70"
					fill="none"
					stroke={color}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	const blur = annotation.blurData;
	const strength = Math.max(2, blur?.intensity ?? blur?.blockSize ?? 12);
	const filter =
		blur?.type === "mosaic"
			? `blur(${Math.max(2, strength / 3)}px) contrast(1.18)`
			: `blur(${strength}px)`;
	return (
		<div
			style={{
				...base,
				borderRadius: blur?.shape === "oval" ? "50%" : "8px",
				backdropFilter: filter,
				WebkitBackdropFilter: filter,
				background: "rgba(127, 127, 127, 0.05)",
			}}
		/>
	);
}

export function AnnotationOverlay({
	annotation,
	isSelected,
	containerWidth,
	containerHeight,
	onPositionChange,
	onRectChange,
	onCommit,
	onClick,
	zIndex,
	isSelectedBoost,
	renderContent,
}: AnnotationOverlayProps) {
	const committedX = (annotation.position.x / 100) * containerWidth;
	const committedY = (annotation.position.y / 100) * containerHeight;
	const committedWidth = (annotation.size.width / 100) * containerWidth;
	const committedHeight = (annotation.size.height / 100) * containerHeight;
	const blurShape = annotation.type === "blur" ? (annotation.blurData?.shape ?? "rectangle") : null;
	const isDraggingRef = useRef(false);
	const [liveRect, setLiveRect] = useState({
		x: committedX,
		y: committedY,
		width: committedWidth,
		height: committedHeight,
	});

	useEffect(() => {
		setLiveRect({
			x: committedX,
			y: committedY,
			width: committedWidth,
			height: committedHeight,
		});
	}, [committedHeight, committedWidth, committedX, committedY]);

	const { x, y, width, height } = liveRect;

	return (
		<Rnd
			position={{ x, y }}
			size={{ width, height }}
			onDragStart={() => {
				isDraggingRef.current = true;
			}}
			onDrag={(_e, d) => {
				setLiveRect((prev) => ({ ...prev, x: d.x, y: d.y }));
				// Rnd moves the visible DOM pixels itself. Replacing the whole project
				// document here added a root render per frame without changing the picture.
			}}
			onDragStop={(_e, d) => {
				setLiveRect((prev) => ({ ...prev, x: d.x, y: d.y }));
				const xPercent = (d.x / containerWidth) * 100;
				const yPercent = (d.y / containerHeight) * 100;
				onPositionChange(annotation.id, { x: xPercent, y: yPercent });
				onCommit?.();
				setTimeout(() => {
					isDraggingRef.current = false;
				}, 100);
			}}
			onResize={(_e, _direction, ref, _delta, position) => {
				setLiveRect({
					x: position.x,
					y: position.y,
					width: ref.offsetWidth,
					height: ref.offsetHeight,
				});
				// Local Rnd state is the complete interactive preview; publish on stop.
			}}
			onResizeStop={(_e, _direction, ref, _delta, position) => {
				setLiveRect({
					x: position.x,
					y: position.y,
					width: ref.offsetWidth,
					height: ref.offsetHeight,
				});
				const xPercent = (position.x / containerWidth) * 100;
				const yPercent = (position.y / containerHeight) * 100;
				const widthPercent = (ref.offsetWidth / containerWidth) * 100;
				const heightPercent = (ref.offsetHeight / containerHeight) * 100;
				onRectChange(annotation.id, {
					position: { x: xPercent, y: yPercent },
					size: { width: widthPercent, height: heightPercent },
				});
				onCommit?.();
			}}
			onClick={() => {
				if (isDraggingRef.current) return;
				onClick(annotation.id);
			}}
			bounds="parent"
			className={cn(
				"cursor-move",
				isSelected &&
					annotation.type !== "blur" &&
					"ring-2 ring-[#27E0C1] ring-offset-2 ring-offset-transparent",
			)}
			style={{
				zIndex: isSelectedBoost ? zIndex + 1000 : zIndex,
				pointerEvents: isSelected ? "auto" : "none",
				border:
					isSelected && annotation.type !== "blur" ? "2px solid rgba(39, 224, 193, 0.8)" : "none",
				backgroundColor:
					isSelected && annotation.type !== "blur" ? "rgba(39, 224, 193, 0.1)" : "transparent",
				boxShadow:
					isSelected && annotation.type !== "blur" ? "0 0 0 1px rgba(39, 224, 193, 0.35)" : "none",
			}}
			// Un flou en tracé libre se déplace et se redimensionne comme les autres : ce qui le
			// bloquait, c'était la zone de saisie du tracé qui capturait le pointeur — et elle est
			// partie avec l'outil.
			enableResizing={isSelected}
			disableDragging={!isSelected}
			resizeHandleStyles={{
				topLeft: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #27E0C1" : "none",
					borderRadius: "50%",
					left: "-6px",
					top: "-6px",
					cursor: "nwse-resize",
				},
				topRight: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #27E0C1" : "none",
					borderRadius: "50%",
					right: "-6px",
					top: "-6px",
					cursor: "nesw-resize",
				},
				bottomLeft: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #27E0C1" : "none",
					borderRadius: "50%",
					left: "-6px",
					bottom: "-6px",
					cursor: "nesw-resize",
				},
				bottomRight: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #27E0C1" : "none",
					borderRadius: "50%",
					right: "-6px",
					bottom: "-6px",
					cursor: "nwse-resize",
				},
			}}
		>
			<div
				className={cn(
					"w-full h-full relative",
					annotation.type !== "blur" && "rounded-lg",
					isSelected && annotation.type !== "blur" && "shadow-lg",
				)}
			>
				{renderContent ? (
					<AnnotationPixels annotation={annotation} containerHeight={containerHeight} />
				) : null}
				{/* Le cadre d'un flou sélectionné, à la forme du masque. Les autres types portent le
				    leur sur le `Rnd` lui-même ; un flou n'en a pas, pour ne pas encadrer la zone qu'il
				    est censé cacher — sans ce liseré il n'aurait AUCUN retour de sélection. */}
				{isSelected && annotation.type === "blur" ? (
					<div
						className="absolute inset-0 pointer-events-none border-2 border-[#27E0C1]/80"
						style={{ borderRadius: blurShape === "oval" ? "50%" : "8px" }}
					/>
				) : null}
			</div>
		</Rnd>
	);
}
