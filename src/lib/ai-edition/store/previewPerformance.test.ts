import { describe, expect, it } from "vitest";
import { getPreviewPerformancePolicy } from "./previewPerformance";

describe("preview performance policy", () => {
	it.each([
		"quality",
		"performance",
	] as const)("keeps %s presentation responsive without mounting the RGBA IPC compositor", (mode) => {
		const policy = getPreviewPerformancePolicy(mode);
		expect(policy.uiFps).toBe(60);
		expect(policy.useNativeCompositor).toBe(false);
	});

	it("reduces visual quality before reducing cadence", () => {
		expect(getPreviewPerformancePolicy("quality").visualQuality).toBe("full");
		expect(getPreviewPerformancePolicy("performance").visualQuality).toBe("reduced");
	});

	it("reserves lower cadence for the explicit power-saving mode", () => {
		const policy = getPreviewPerformancePolicy("power-saving");
		expect(policy.uiFps).toBe(30);
		expect(policy.visualQuality).toBe("reduced");
		expect(policy.useNativeCompositor).toBe(false);
	});
});
