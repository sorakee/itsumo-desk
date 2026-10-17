import { Channel } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  type Capabilities,
  commands,
  events,
  type Preset,
  type PresetInfo,
  type ProviderSummary,
  type ProviderUpdate,
  type TestEvent,
  type TestReport,
} from "./bindings";
import { unwrap } from "./result";

export type {
  Capabilities,
  Preset,
  PresetInfo,
  ProviderSummary,
  ProviderUpdate,
  TestEvent,
  TestReport,
};

/** The presets a new profile can start from, in display order. */
export function providerPresets(): Promise<PresetInfo[]> {
  return commands.providerPresets();
}

/** The provider profiles, in the order they were added. */
export function listProviders(): Promise<ProviderSummary[]> {
  return unwrap(commands.listProviders());
}

/** Creates a profile from a preset and resolves to its id. */
export function addProvider(preset: Preset): Promise<string> {
  return unwrap(commands.addProvider(preset));
}

/** Saves a profile's editable fields; the core trims and checks them. */
export async function updateProvider(id: string, update: ProviderUpdate): Promise<void> {
  await unwrap(commands.updateProvider(id, update));
}

/** Deletes a profile and its stored key. */
export async function removeProvider(id: string): Promise<void> {
  await unwrap(commands.removeProvider(id));
}

/** Makes a profile the one chat uses, or with null leaves chat without one. */
export async function setMainProvider(id: string | null): Promise<void> {
  await unwrap(commands.setMainProvider(id));
}

/** Hands a key to the core's credential store. It is never sent back. */
export async function setProviderKey(id: string, key: string): Promise<void> {
  await unwrap(commands.setProviderKey(id, key));
}

/** Deletes a profile's stored key. */
export async function clearProviderKey(id: string): Promise<void> {
  await unwrap(commands.clearProviderKey(id));
}

/** The model names the profile's server lists. */
export function providerModels(id: string): Promise<string[]> {
  return unwrap(commands.providerModels(id));
}

/** Asks the profile's model for a short reply, calling `onEvent` as it streams in. */
export function testProvider(id: string, onEvent: (event: TestEvent) => void): Promise<TestReport> {
  const channel = new Channel<TestEvent>();
  channel.onmessage = onEvent;
  return unwrap(commands.testProvider(id, channel));
}

/** Subscribes to changes in the profiles, their keys, or which one chat uses. */
export function onProvidersChanged(handler: () => void): Promise<UnlistenFn> {
  return events.providersChanged.listen(() => handler());
}
