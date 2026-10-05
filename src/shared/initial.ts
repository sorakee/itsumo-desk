/** The first character of a name, for avatars without an icon. Whole code points, so emoji and CJK survive. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
