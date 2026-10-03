// Fetches the Live2D Cubism SDK for Web into vendor/cubism/ (gitignored).
//
// The SDK is not redistributable through this repository. Downloading it means you accept
// Live2D's licence terms, so the script refuses to run without --accept-license.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SDK_VERSION = "5-r.5";
const SDK_NAME = `CubismSdkForWeb-${SDK_VERSION}`;
const SDK_URL = `https://cubism.live2d.com/sdk-web/bin/${SDK_NAME}.zip`;
const LICENSE_URLS = [
  "https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html",
  "https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html",
  "https://www.live2d.com/en/sdk/license/",
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(repoRoot, "vendor", "cubism");

if (!process.argv.includes("--accept-license")) {
  console.error("The Live2D Cubism SDK has its own licence terms:\n");
  for (const url of LICENSE_URLS) {
    console.error(`  ${url}`);
  }
  console.error("\nRe-run with --accept-license once you have read and accepted them:");
  console.error("  pnpm setup:cubism --accept-license");
  process.exit(1);
}

function extractZip(zipPath, outDir) {
  // Windows ships bsdtar, which reads zip archives. Git Bash's GNU tar does not, so the
  // system binary is addressed explicitly.
  const [cmd, args] =
    process.platform === "win32"
      ? [
          join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
          ["-xf", zipPath, "-C", outDir],
        ]
      : ["unzip", ["-q", zipPath, "-d", outDir]];
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`failed to extract ${zipPath} with ${cmd}`);
  }
}

const work = mkdtempSync(join(tmpdir(), "cubism-sdk-"));
try {
  console.log(`Downloading ${SDK_URL}`);
  const response = await fetch(SDK_URL);
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  const zipPath = join(work, "sdk.zip");
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));

  extractZip(zipPath, work);
  const sdkRoot = join(work, SDK_NAME);
  for (const part of ["Core", "Framework"]) {
    if (!existsSync(join(sdkRoot, part))) {
      throw new Error(`unexpected archive layout: ${SDK_NAME}/${part} not found`);
    }
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const part of ["Core", "Framework"]) {
    cpSync(join(sdkRoot, part), join(dest, part), { recursive: true });
  }
  writeFileSync(join(dest, "VERSION"), `${SDK_VERSION}\n`);
  console.log(`Cubism SDK ${SDK_VERSION} installed to vendor/cubism/`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
