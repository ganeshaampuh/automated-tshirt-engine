import { DesignSchema, type Design, type Member, type Set } from "./types";
import { collage, type TemplateContext } from "./templates/collage";

export function applyOverrides(design: Design, overrides: Member["overrides"]): Design {
  if (!overrides) return design;
  // The cast is safe only because DesignSchema.parse below re-validates the merged layer.
  const layers = design.layers.map(l => (overrides[l.id] ? ({ ...l, ...overrides[l.id] } as typeof l) : l));
  return DesignSchema.parse({ ...design, layers }); // throws if an override produced an invalid layer
}

/**
 * Redraws the stack in the member's stored order. Both renderers walk `design.layers` in array
 * order, so this is the whole of z-ordering — nothing downstream needs to know about it.
 *
 * TODO(decide): what a *stale* order means. The template's layer set is not frozen — wording and
 * language decide which slots it emits — so a saved order can name a layer that is no longer drawn,
 * or miss one that now is. Today this ignores any order that does not name exactly the layers the
 * template produced, which is safe (never drops a layer) but throws away the user's arrangement the
 * moment the set changes shape. The alternative: keep the listed ids that still exist, in the listed
 * order, then append the unmentioned layers on top in their template order — the arrangement
 * survives, at the cost of a new layer always landing in front. Pick one; the two "ignores…" cases
 * in `tests/engine/expand.test.ts` pin the current rule.
 */
export function applyOrder(design: Design, order: Member["order"]): Design {
  if (!order) return design;
  const byId = new Map(design.layers.map(l => [l.id, l]));
  if (order.length !== byId.size || !order.every(id => byId.has(id))) return design;
  return { ...design, layers: order.map(id => byId.get(id)!) };
}

/**
 * Drops the layers this member has hidden.
 *
 * Deliberately the last step. `applyOrder` compares a stored order against the layers the template
 * produced and discards it when the two disagree, so hiding a layer before the reorder would read
 * as a stale order and throw away the member's arrangement. Running after it means nothing
 * downstream — renderers, `boundingBox`, the safe-area check, the exporter — ever sees a hidden
 * layer or needs to know the concept exists.
 */
export function dropHidden(design: Design): { design: Design; hidden: string[] } {
  const hidden = design.layers.filter(l => l.hidden).map(l => l.id);
  if (!hidden.length) return { design, hidden };
  return { design: { ...design, layers: design.layers.filter(l => !l.hidden) }, hidden };
}

/**
 * One design per member, plus the ids this member hid.
 *
 * `hidden` is read off the drawn stack rather than off `overrides`, and the difference matters: an
 * override can name a layer this member's template never drew — the wording decides which slots
 * the collage emits — and offering the shop a layer back that was never there is a dead button.
 */
export function expand(set: Set, ctx: TemplateContext): { memberId: string; design: Design; hidden: string[] }[] {
  return set.input.members.map(m => {
    const { design, hidden } = dropHidden(applyOrder(applyOverrides(collage(set, m, ctx), m.overrides), m.order));
    return { memberId: m.id, design, hidden };
  });
}
