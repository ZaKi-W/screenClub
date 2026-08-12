// Chrome d'édition d'une annotation : cadre de sélection, glissement, poignées de
// redimensionnement. Les PIXELS de l'annotation — texte, image, flèche, flou — sont peints par le
// compositeur natif, aperçu compris.
//
// Ce fichier était le port du `AnnotationOverlay` de l'éditeur v2 : il rendait les quatre types en
// DOM et portait la saisie du tracé libre, soit ~400 lignes qui ne s'exécutaient plus depuis que
// le natif peint l'aperçu. Les garder ne coûtait pas seulement de la lecture : elles décrivaient un
// rendu concurrent, sur une autre horloge, ce qui avait déjà produit le bug des annotations
// affichées en double (une copie collée au curseur, un fantôme resté en place jusqu'au
// relâchement). Le détail reste dans `git log`.

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
	/** Écriture disque, appelée une fois en fin de geste — le drag/resize ne fait que du live. */
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
	type PendingLivePatch =
		| { kind: "position"; position: { x: number; y: number } }
		| {
				kind: "rect";
				position: { x: number; y: number };
				size: { width: number; height: number };
		  };
	const pendingLivePatchRef = useRef<PendingLivePatch | null>(null);
	const livePatchRafRef = useRef(0);
	const flushLivePatch = () => {
		if (livePatchRafRef.current !== 0) {
			cancelAnimationFrame(livePatchRafRef.current);
			livePatchRafRef.current = 0;
		}
		const pending = pendingLivePatchRef.current;
		pendingLivePatchRef.current = null;
		if (!pending) return;
		if (pending.kind === "position") onPositionChange(annotation.id, pending.position);
		else onRectChange(annotation.id, { position: pending.position, size: pending.size });
	};
	const queueLivePatch = (patch: PendingLivePatch) => {
		pendingLivePatchRef.current = patch;
		if (livePatchRafRef.current !== 0) return;
		livePatchRafRef.current = requestAnimationFrame(() => {
			livePatchRafRef.current = 0;
			flushLivePatch();
		});
	};
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

	useEffect(
		() => () => {
			if (livePatchRafRef.current !== 0) cancelAnimationFrame(livePatchRafRef.current);
		},
		[],
	);

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
				// Pousse la position PENDANT le geste : c'est le natif qui peint, il doit donc suivre
				// le curseur. `onPositionChange` ne met à jour qu'en mémoire ; l'écriture disque se
				// fait une seule fois, au relâchement (`onCommit`).
				queueLivePatch({
					kind: "position",
					position: {
						x: (d.x / containerWidth) * 100,
						y: (d.y / containerHeight) * 100,
					},
				});
			}}
			onDragStop={(_e, d) => {
				setLiveRect((prev) => ({ ...prev, x: d.x, y: d.y }));
				const xPercent = (d.x / containerWidth) * 100;
				const yPercent = (d.y / containerHeight) * 100;
				pendingLivePatchRef.current = {
					kind: "position",
					position: { x: xPercent, y: yPercent },
				};
				flushLivePatch();
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
				// Même raison que le drag : le natif doit suivre la poignée en direct.
				queueLivePatch({
					kind: "rect",
					position: {
						x: (position.x / containerWidth) * 100,
						y: (position.y / containerHeight) * 100,
					},
					size: {
						width: (ref.offsetWidth / containerWidth) * 100,
						height: (ref.offsetHeight / containerHeight) * 100,
					},
				});
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
				pendingLivePatchRef.current = {
					kind: "rect",
					position: { x: xPercent, y: yPercent },
					size: { width: widthPercent, height: heightPercent },
				};
				flushLivePatch();
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
