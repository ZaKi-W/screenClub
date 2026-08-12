import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDir, "..");
const outputDir = path.resolve(projectRoot, "dist-electron");

// Keep this deletion deliberately narrow: a typo or a changed directory layout
// must fail closed rather than turn a build cleanup into a broad recursive rm.
if (path.dirname(outputDir) !== projectRoot || path.basename(outputDir) !== "dist-electron") {
	throw new Error(`Refusing to clean unexpected output directory: ${outputDir}`);
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });
