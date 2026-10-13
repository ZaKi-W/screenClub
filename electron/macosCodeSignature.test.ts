import { describe, expect, it } from "vitest";
import { parseMacCodeSigningTeam } from "./macosCodeSignature";

describe("parseMacCodeSigningTeam", () => {
	it("returns a Developer ID team", () => {
		expect(parseMacCodeSigningTeam("Identifier=com.example.app\nTeamIdentifier=AB12CD34EF\n")).toBe(
			"AB12CD34EF",
		);
	});

	it("rejects ad-hoc and local signatures without a team", () => {
		expect(
			parseMacCodeSigningTeam("Identifier=com.example.app\nTeamIdentifier=not set\n"),
		).toBeNull();
		expect(parseMacCodeSigningTeam("Identifier=com.example.app\n")).toBeNull();
	});
});
