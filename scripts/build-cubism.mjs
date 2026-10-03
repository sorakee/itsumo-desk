// Compiles the Cubism Web Framework in vendor/cubism/ (see setup-cubism.mjs) into
// vendor/cubism/Framework/dist/. Run by setup-cubism.mjs; run it directly with
// `pnpm build:cubism` after changing scripts/tsconfig.cubism.json.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const framework = join(scriptsDir, "..", "vendor", "cubism", "Framework");

if (!existsSync(join(framework, "src"))) {
  console.error("vendor/cubism/Framework/src not found. Run `pnpm setup:cubism` first.");
  process.exit(1);
}

rmSync(join(framework, "dist"), { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [tsc, "-p", join(scriptsDir, "tsconfig.cubism.json")], {
  stdio: "inherit",
});
if (result.status !== 0) {
  console.error("Cubism Framework build failed.");
  process.exit(result.status ?? 1);
}
console.log("Cubism Framework built to vendor/cubism/Framework/dist/");
