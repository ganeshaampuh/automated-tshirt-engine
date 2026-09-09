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

export function expand(set: Set, ctx: TemplateContext): { memberId: string; design: Design }[] {
  return set.input.members.map(m => ({
    memberId: m.id,
    design: applyOrder(applyOverrides(collage(set, m, ctx), m.overrides), m.order),
  }));
}
