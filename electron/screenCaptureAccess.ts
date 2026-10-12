export type ScreenCaptureAccessStatus =
	| "granted"
	| "denied"
	| "restricted"
	| "not-determined"
	| "unknown";

export interface ScreenCaptureAccessResolution {
	granted: boolean;
	status: ScreenCaptureAccessStatus;
	probeError?: unknown;
}

/**
 * Resolve access from the operation we actually need, not just the cached TCC status.
 * On some macOS/Electron combinations getMediaAccessStatus("screen") can remain stale
 * even while the app is enabled in System Settings.
 */
export async function resolveScreenCaptureAccess({
	initialStatus,
	probeSources,
	readStatus,
}: {
	initialStatus: ScreenCaptureAccessStatus;
	probeSources: () => Promise<boolean>;
	readStatus: () => ScreenCaptureAccessStatus;
}): Promise<ScreenCaptureAccessResolution> {
	if (initialStatus === "granted") {
		return { granted: true, status: initialStatus };
	}

	let probeError: unknown;
	try {
		if (await probeSources()) {
			return { granted: true, status: "granted" };
		}
	} catch (error) {
		probeError = error;
	}

	const refreshedStatus = readStatus();
	return {
		granted: refreshedStatus === "granted",
		status: refreshedStatus,
		...(probeError === undefined ? {} : { probeError }),
	};
}
