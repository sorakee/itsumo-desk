// The companion menu's items (D41), clockwise from the top. Items for features that are not
// built yet are left out rather than shown disabled.

import {
  type CharacterSummary,
  hideCompanion,
  openSettings,
  setActiveCharacter,
  setAlwaysOnTop,
} from "@/ipc";
import type { IconName } from "@/shared/icons";
import { useCharactersStore } from "@/stores/characters";
import { useCompanionStore } from "@/stores/companion";
import { CHARACTER_RING_SIZE, characterRing } from "@/windows/companion/characterRing";

/** Button colours from the comic palette; see `CompanionMenu.module.css`. */
export type MenuTone = "coral" | "teal" | "orange" | "yellow";

const TONES: readonly MenuTone[] = ["coral", "teal", "orange", "yellow"];

/** The ring the menu shows: the items, or the installed characters (D42). */
export type MenuPage = "main" | "characters";

export type MenuFace =
  | { kind: "icon"; icon: IconName }
  | { kind: "avatar"; name: string; iconUrl: string | null };

interface MenuItemBase {
  id: string;
  face: MenuFace;
  label: string;
  tone: MenuTone;
  /** Set on choices of one; true marks the current one. */
  checked?: boolean;
}

/** An item either runs an action (and closes the menu) or opens another ring. */
export type MenuItem = MenuItemBase & ({ run: () => Promise<void> } | { opens: MenuPage });

const icon = (name: IconName): MenuFace => ({ kind: "icon", icon: name });

// Nothing to do: choosing the current character only closes the menu.
const keep = () => Promise.resolve();

function mainItems(alwaysOnTop: boolean, hasCharacters: boolean): MenuItem[] {
  return [
    {
      id: "pin",
      face: icon(alwaysOnTop ? "pinOff" : "pin"),
      label: alwaysOnTop ? "Unpin" : "Pin on top",
      tone: "coral",
      run: () => setAlwaysOnTop(!alwaysOnTop),
    },
    // A ring holding only "Manage…" would be a detour, so with none installed it goes
    // straight to Settings, where the import is.
    {
      id: "characters",
      face: icon("character"),
      label: "Characters",
      tone: "yellow",
      ...(hasCharacters ? { opens: "characters" as const } : { run: openSettings }),
    },
    { id: "settings", face: icon("settings"), label: "Settings", tone: "teal", run: openSettings },
    { id: "hide", face: icon("hide"), label: "Hide", tone: "orange", run: hideCompanion },
  ];
}

function characterItems(
  characters: readonly CharacterSummary[],
  activeId: string | null,
): MenuItem[] {
  const { shown, overflow } = characterRing(characters, activeId, CHARACTER_RING_SIZE - 1);
  const items: MenuItem[] = shown.map((character, index) => ({
    id: `character-${character.id}`,
    face: { kind: "avatar", name: character.name, iconUrl: character.iconUrl },
    label: character.name,
    tone: TONES[index % TONES.length] ?? "coral",
    checked: character.id === activeId,
    run: character.id === activeId ? keep : () => setActiveCharacter(character.id),
  }));
  items.push({
    id: "manage",
    face: icon("manage"),
    label: overflow ? "More in Settings…" : "Manage…",
    tone: "teal",
    run: openSettings,
  });
  return items;
}

export function useMenuItems(page: MenuPage): MenuItem[] {
  const alwaysOnTop = useCompanionStore((state) => state.alwaysOnTop);
  const characters = useCharactersStore((state) => state.characters);
  const activeId = useCharactersStore((state) => state.active?.id ?? null);
  return page === "main"
    ? mainItems(alwaysOnTop, (characters?.length ?? 0) > 0)
    : characterItems(characters ?? [], activeId);
}
