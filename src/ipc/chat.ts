import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  type ChatStatus,
  commands,
  events,
  type HotkeyStatus,
  type SpeechSegment,
  type TurnEnded,
} from "./bindings";
import { unwrap } from "./result";

export type { ChatStatus, HotkeyStatus, SpeechSegment, TurnEnded };

/** Whether chat has a provider it can call, and if not, what to set up. */
export function chatStatus(): Promise<ChatStatus> {
  return commands.chatStatus();
}

/**
 * Sends the user's message, interrupting any reply in progress, and resolves to the new
 * turn's id. The reply arrives through `onSpeechSegment`, then `onTurnEnded`.
 */
export function sendChat(text: string): Promise<number> {
  return unwrap(commands.sendChat(text));
}

/** Tells the core a segment is on screen; an interrupted reply keeps what was shown. */
export async function reportSegmentShown(turn: number, index: number): Promise<void> {
  await commands.reportSegmentShown(turn, index);
}

export function onSpeechSegment(handler: (segment: SpeechSegment) => void): Promise<UnlistenFn> {
  return events.speechSegment.listen(({ payload }) => handler(payload));
}

export function onTurnEnded(handler: (ended: TurnEnded) => void): Promise<UnlistenFn> {
  return events.turnEnded.listen(({ payload }) => handler(payload));
}

/** Subscribes to the chat hotkey, which asks the companion to open its chat input. */
export function onChatRequested(handler: () => void): Promise<UnlistenFn> {
  return events.chatRequested.listen(() => handler());
}

/** The chat hotkey and whether Windows registered it. */
export function chatHotkey(): Promise<HotkeyStatus> {
  return commands.chatHotkey();
}

/** Rebinds the chat hotkey (e.g. `Ctrl+Shift+KeyK`), or with null restores the default. */
export function setChatHotkey(shortcut: string | null): Promise<HotkeyStatus> {
  return unwrap(commands.setChatHotkey(shortcut));
}
