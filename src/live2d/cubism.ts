// Starts the Cubism Framework, once per page. The Core itself is a classic script loaded by
// the window's HTML entry, because Framework modules read it as soon as they are imported.

import { CubismFramework, LogLevel } from "@cubism/framework/live2dcubismframework";

/** Served by the `cubismAssets` plugin in vite.config.ts. */
export const CUBISM_SHADER_PATH = "/cubism/shaders/";

const CORE_READY_TIMEOUT_MS = 10_000;

let started: Promise<void> | undefined;

function coreIsReady(): boolean {
  try {
    Live2DCubismCore.Version.csmGetVersion();
    return true;
  } catch {
    return false;
  }
}

// The Core instantiates its WebAssembly asynchronously after the script runs and exposes
// no ready hook, so wait until a Core call stops throwing.
async function waitForCore(): Promise<void> {
  const deadline = performance.now() + CORE_READY_TIMEOUT_MS;
  while (!coreIsReady()) {
    if (performance.now() > deadline) {
      throw new Error("Cubism Core did not initialise");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function start(): Promise<void> {
  await waitForCore();
  CubismFramework.startUp({
    logFunction: (message) => console.debug(`[cubism] ${message.trimEnd()}`),
    loggingLevel: import.meta.env.DEV ? LogLevel.LogLevel_Info : LogLevel.LogLevel_Warning,
  });
  CubismFramework.initialize();
}

/** Resolves once the Core is ready and the Framework is initialised. Safe to call often. */
export function startCubism(): Promise<void> {
  started ??= start().catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}
