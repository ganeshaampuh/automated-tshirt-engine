/**
 * What a set is called in a list.
 *
 * A set's `name` is optional, so the title falls back through: the shop's own label, then the
 * child's name, then a marker for a row whose input will not parse. When a name is showing, the
 * child's name becomes the subtitle rather than disappearing — the shop still needs to see whose
 * birthday an order is for.
 */
export type SetTitle = { title: string; subtitle: string | undefined };

/** The name shown for a set whose stored input could not be parsed. */
export const BROKEN_TITLE = "Data rusak";

export function setTitle(input: { kidName: string; name?: string } | null): SetTitle {
  if (!input) return { title: BROKEN_TITLE, subtitle: undefined };
  const name = input.name?.trim();
  if (!name || name === input.kidName) return { title: input.kidName, subtitle: undefined };
  return { title: name, subtitle: input.kidName };
}
