import { spawnSync } from "node:child_process";

export function parseMacCodeSigningTeam(details: string) {
	const teamIdentifier = details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
	return teamIdentifier && teamIdentifier !== "not set" ? teamIdentifier : null;
}

/**
 * Native capture/cursor helpers are separate TCC clients. They are safe in a packaged app only
 * when the app and helpers carry a stable Apple signing team. Ad-hoc and local self-signed builds
 * deliberately use Chromium capture under the parent app identity instead.
 */
export function hasStableMacCodeSigningTeam(executablePath = process.execPath) {
	if (process.platform !== "darwin") return false;

	const inspection = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", executablePath], {
		encoding: "utf8",
	});
	if (inspection.status !== 0) return false;
	return parseMacCodeSigningTeam(`${inspection.stdout}${inspection.stderr}`) !== null;
}
