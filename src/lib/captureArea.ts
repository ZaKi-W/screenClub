export interface CaptureAreaRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CaptureAreaSelection {
	displayId: number;
	rect: CaptureAreaRect;
}
