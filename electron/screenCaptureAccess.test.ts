import { describe, expect, it, vi } from "vitest";
import { resolveScreenCaptureAccess } from "./screenCaptureAccess";

describe("resolveScreenCaptureAccess", () => {
	it("trusts a successful source probe when the cached status says denied", async () => {
		const result = await resolveScreenCaptureAccess({
			initialStatus: "denied",
			probeSources: async () => true,
			readStatus: () => "denied",
		});

		expect(result).toEqual({ granted: true, status: "granted" });
	});

	it("does not probe when the cached status is already granted", async () => {
		const probeSources = vi.fn(async () => true);
		const result = await resolveScreenCaptureAccess({
			initialStatus: "granted",
			probeSources,
			readStatus: () => "granted",
		});

		expect(result).toEqual({ granted: true, status: "granted" });
		expect(probeSources).not.toHaveBeenCalled();
	});

	it("uses the refreshed status after the probe requests access", async () => {
		const result = await resolveScreenCaptureAccess({
			initialStatus: "not-determined",
			probeSources: async () => false,
			readStatus: () => "granted",
		});

		expect(result).toEqual({ granted: true, status: "granted" });
	});

	it("preserves a probe failure for diagnostics without inventing access", async () => {
		const error = new Error("capture unavailable");
		const result = await resolveScreenCaptureAccess({
			initialStatus: "denied",
			probeSources: async () => {
				throw error;
			},
			readStatus: () => "denied",
		});

		expect(result).toEqual({ granted: false, status: "denied", probeError: error });
	});
});
