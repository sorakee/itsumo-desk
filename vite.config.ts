import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
const cubismDir = fileURLToPath(new URL("./vendor/cubism", import.meta.url));

/**
 * Serves the Cubism Core script and the Framework's shader files under `/cubism/` in dev and
 * copies them, unhashed and unmodified, into the bundle. The Core is a classic script that
 * must be redistributed as is, and the Framework fetches its shaders by directory path, so
 * neither can go through the module graph.
 */
function cubismAssets(): Plugin {
  const files = new Map<string, string>();

  return {
    name: "itsumo:cubism-assets",
    configResolved(config) {
      const core = join(cubismDir, "Core", "live2dcubismcore.min.js");
      const shaders = join(cubismDir, "Framework", "Shaders", "WebGL");
      if (!existsSync(core) || !existsSync(shaders)) {
        // Unit tests never touch the renderer, so they run without the SDK.
        if (config.mode === "test") {
          return;
        }
        throw new Error("Cubism SDK not found in vendor/cubism/. Run `pnpm setup:cubism`.");
      }
      files.set("cubism/live2dcubismcore.min.js", core);
      for (const name of readdirSync(shaders)) {
        files.set(`cubism/shaders/${name}`, join(shaders, name));
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url && files.get(decodeURIComponent(req.url.split("?")[0] ?? "").slice(1));
        if (!path) {
          next();
          return;
        }
        res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/plain");
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [fileName, path] of files) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cubismAssets()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Compiled by scripts/build-cubism.mjs; the Framework's source does not pass our tsconfig.
      "@cubism/framework": join(cubismDir, "Framework", "dist"),
    },
  },

  // One HTML entry per Tauri window.
  build: {
    rolldownOptions: {
      input: {
        companion: fileURLToPath(new URL("./index.html", import.meta.url)),
        settings: fileURLToPath(new URL("./settings.html", import.meta.url)),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
