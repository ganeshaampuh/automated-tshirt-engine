import { DesignSchema, type Design, type Member, type Set } from "./types";
import { collage, type TemplateContext } from "./templates/collage";

export function applyOverrides(design: Design, overrides: Member["overrides"]): Design {
  if (!overrides) return design;
  // The cast is safe only because DesignSchema.parse below re-validates the merged layer.
  const layers = design.layers.map(l => (overrides[l.id] ? ({ ...l, ...overrides[l.id] } as typeof l) : l));
  return DesignSchema.parse({ ...design, layers }); // throws if an override produced an invalid layer
}

export function expand(set: Set, ctx: TemplateContext): { memberId: string; design: Design }[] {
  return set.input.members.map(m => ({ memberId: m.id, design: applyOverrides(collage(set, m, ctx), m.overrides) }));
}
