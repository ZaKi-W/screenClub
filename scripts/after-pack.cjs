// electron-builder afterPack hook: ensure local macOS builds have a complete bundle signature.
//
// electron-builder 26 skips app signing entirely when no certificate is installed. The Electron
// executable's linker signature then says Identifier=Electron while Info.plist says
// com.etiennelescot.openscreen. macOS TCC cannot attach Screen Recording or Accessibility grants
// to that mismatched identity. Release CI already applied the same ad-hoc fallback after packing;
// keeping it here makes the default local packaging path safe too. When a Developer ID is
// configured, electron-builder signs after this hook and replaces the ad-hoc signature.

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") return;

	const productFilename = context.packager.appInfo.productFilename;
	const appPath = path.join(context.appOutDir, `${productFilename}.app`);
	const entitlementsPath = path.join(context.packager.projectDir, "macos.entitlements");

	execFileSync(
		"codesign",
		[
			"--force",
			"--deep",
			"--sign",
			"-",
			"--options",
			"runtime",
			"--entitlements",
			entitlementsPath,
			appPath,
		],
		{ stdio: "inherit" },
	);
	execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });

	const expectedIdentifier = context.packager.appInfo.id;
	const inspection = spawnSync("codesign", ["-dv", "--verbose=2", appPath], {
		encoding: "utf8",
	});
	if (inspection.status !== 0) {
		throw new Error(inspection.stderr || "Could not inspect the macOS app signature");
	}
	const signatureDetails = `${inspection.stdout}${inspection.stderr}`;
	const actualIdentifier = signatureDetails.match(/^Identifier=(.+)$/m)?.[1];
	if (actualIdentifier !== expectedIdentifier) {
		throw new Error(
			`macOS signature identifier is ${actualIdentifier ?? "missing"}; expected ${expectedIdentifier}`,
		);
	}
};
