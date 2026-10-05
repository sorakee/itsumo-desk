import { describe, expect, it } from "vitest";
import type { CharacterSummary } from "@/ipc";
import { characterRing } from "@/windows/companion/characterRing";

function installed(count: number, favorites: readonly number[] = []): CharacterSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    name: `Character ${index}`,
    packName: `Character ${index}`,
    favorite: favorites.includes(index),
    author: "",
    license: "",
    iconUrl: null,
  }));
}

const ids = (characters: CharacterSummary[]) => characters.map((character) => character.id);

describe("characterRing", () => {
  it("shows every character that fits, in order", () => {
    const ring = characterRing(installed(3), "c1", 7);
    expect(ids(ring.shown)).toEqual(["c0", "c1", "c2"]);
    expect(ring.overflow).toBe(false);
  });

  it("fills exactly the available slots without overflow", () => {
    expect(characterRing(installed(7), null, 7).overflow).toBe(false);
  });

  it("keeps the first ones when more are installed", () => {
    const ring = characterRing(installed(9), "c2", 7);
    expect(ids(ring.shown)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(ring.overflow).toBe(true);
  });

  it("puts a left-out active character in the last slot", () => {
    const ring = characterRing(installed(9), "c8", 7);
    expect(ids(ring.shown)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c8"]);
  });

  it("ignores an active id that is not installed", () => {
    const ring = characterRing(installed(9), "gone", 7);
    expect(ids(ring.shown)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6"]);
  });

  it("puts favourites first, keeping the order within each group", () => {
    const ring = characterRing(installed(4, [3, 1]), "c0", 7);
    expect(ids(ring.shown)).toEqual(["c1", "c3", "c0", "c2"]);
  });

  it("lets favourites decide who fits", () => {
    const ring = characterRing(installed(9, [8, 7]), null, 7);
    expect(ids(ring.shown)).toEqual(["c7", "c8", "c0", "c1", "c2", "c3", "c4"]);
    expect(ring.overflow).toBe(true);
  });

  it("still makes room for a left-out active character after the favourites", () => {
    const ring = characterRing(installed(9, [8]), "c7", 7);
    expect(ids(ring.shown)).toEqual(["c8", "c0", "c1", "c2", "c3", "c4", "c7"]);
  });

  it("does not change the list it was given", () => {
    const characters = installed(9);
    characterRing(characters, "c8", 7);
    expect(ids(characters)).toHaveLength(9);
    expect(characters[6]?.id).toBe("c6");
  });
});
