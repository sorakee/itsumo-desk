# Itsumo Desk

A lightweight, always-present desktop companion. Import a Live2D character, give it a
personality and a voice, and it lives on your desktop: watching your cursor, reacting to
what you say, speaking through VOICEVOX, and occasionally doing its own thing.

> **Status:** early development. Nothing here is usable yet.

## Planned features

- **Your model** — import any Live2D Cubism 3/4/5 model and map its expressions and
  motions in a visual editor. No naming standard to follow.
- **Your LLM** — bring your own key (Claude, GPT, DeepSeek, OpenRouter, ...) or point it
  at a local OpenAI-compatible server (Ollama, LM Studio, llama.cpp).
- **Alive** — breathing, blinking, gaze following, idle behaviour driven by personality
  traits, and vowel-accurate lip sync.
- **Voice** — Japanese speech through VOICEVOX with subtitles in your language, and
  push-to-talk input via local Whisper.
- **Autonomy with limits** — the companion can open apps you've allowlisted, control
  media, and use MCP or CLI tools, all behind a tiered permission system. Unprompted LLM
  calls are rate-capped.
- **Memory** — local conversation history and long-term facts you can view and delete.
- **Desktop-native** — transparent, always-on-top window with click-through around the
  character.

## Platform

Windows 11. macOS and Linux are planned for later.

## Tech stack

Tauri 2 (Rust) · React + TypeScript · Vite · Live2D Cubism SDK for Web · SQLite

## Development

Prerequisites: [pnpm](https://pnpm.io/), Rust (stable), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for Windows. pnpm downloads
the Node.js version the project needs, so your system Node version does not matter.

```sh
pnpm install
pnpm setup:cubism --accept-license   # fetches the Live2D Cubism SDK into vendor/ (see below)
pnpm tauri dev
```

Checks:

```sh
pnpm check    # Biome lint/format + TypeScript
pnpm test     # Vitest
pnpm format   # apply Biome fixes

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test    # also regenerates src/ipc/bindings.ts
```

`src/ipc/bindings.ts` is generated from the Rust command and event types. After changing
them, run `cargo test` and commit the updated file; CI fails if it is stale.

## Third-party components

Itsumo Desk does not include the Live2D Cubism SDK, Live2D models, the VOICEVOX engine,
or VOICEVOX voices. Each has its own licence and usage terms, which you are responsible
for following:

- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/)
- [VOICEVOX](https://voicevox.hiroshiba.jp/)

## Licence

[MIT](LICENSE)
