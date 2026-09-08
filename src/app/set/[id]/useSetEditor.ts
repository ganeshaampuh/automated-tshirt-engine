"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import {
  DEFAULT_FONT,
  SetInputSchema,
  defaultWording,
  expand,
  isWithinSafeArea,
  type Design,
  type ImageLayer,
  type Member,
  type SetInput,
  type SetStyle,
  type TextLayer,
  type Wording,
} from "@/engine";
import { useBrowserMeasurer } from "@/engine/render/browser/useBrowserMeasurer";

/** Layer fields an edit can write, in print px — the same shape `DesignStage` reports. */
export type LayerPatch = Partial<Omit<TextLayer, "id" | "type">> & Partial<Omit<ImageLayer, "id" | "type">>;

/** "set" spreads an edit across every member (and into the shared style); "member" keeps it local. */
export type Scope = "set" | "member";

export type EditorState = {
  id: string;
  input: SetInput;
  style: SetStyle | null;
  memberId: string;
};

export type Action =
  | { type: "setInput"; patch: Partial<SetInput> }
  | { type: "setStyle"; patch: Partial<SetStyle> }
  | { type: "setMember"; id: string }
  | { type: "addMember"; member: Member }
  | { type: "removeMember"; id: string }
  | { type: "updateMember"; id: string; patch: Partial<Member> }
  | { type: "patchLayer"; memberId: string; layerId: string; patch: LayerPatch; scope: Scope }
  | { type: "resetOverride"; memberId: string; layerId: string }
  | { type: "loaded"; style: SetStyle };

export const STARTER_PALETTE = { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" };

/**
 * A style to draw with before the AI has picked one. Only possible once a clipart exists, since the
 * collage template needs an image; it is real state (the editor dispatches `loaded` with it), so a
 * set can be previewed, saved and exported without spending an AI call.
 */
export function starterStyle(input: SetInput): SetStyle | null {
  if (!input.clipartSrc) return null;
  return {
    template: "collage",
    font: DEFAULT_FONT,
    palette: { ...STARTER_PALETTE },
    clipartSrc: input.clipartSrc,
    wording: defaultWording(input),
  };
}

/** Rewrites only the wording still sitting at its generated default, so hand-written copy survives. */
function syncWording(wording: Wording, prev: SetInput, next: SetInput): Wording {
  const before = defaultWording(prev);
  const after = defaultWording(next);
  const out = { ...wording };
  for (const key of Object.keys(after) as (keyof Wording)[]) {
    if (out[key] === before[key]) out[key] = after[key];
  }
  return out;
}

function withOverride(m: Member, layerId: string, patch: Record<string, unknown>): Member {
  if (!Object.keys(patch).length) return m;
  return { ...m, overrides: { ...m.overrides, [layerId]: { ...m.overrides?.[layerId], ...patch } } };
}

function mapMembers(input: SetInput, ids: (m: Member) => boolean, f: (m: Member) => Member): SetInput {
  return { ...input, members: input.members.map(m => (ids(m) ? f(m) : m)) };
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "setInput": {
      let input: SetInput = { ...state.input, ...action.patch };
      const name = action.patch.kidName;
      // The birthday kid's tab follows the name until someone renames the tab by hand.
      if (name !== undefined && name !== state.input.kidName) {
        input = mapMembers(input, m => m.kind === "birthday-kid" && m.label === state.input.kidName, m => ({
          ...m,
          label: name || m.label,
        }));
      }
      let style = state.style;
      if (style) {
        style = { ...style, wording: syncWording(style.wording, state.input, input) };
        if (input.clipartSrc && input.clipartSrc !== style.clipartSrc) style = { ...style, clipartSrc: input.clipartSrc };
      }
      return { ...state, input, style };
    }

    case "setStyle":
      return state.style ? { ...state, style: { ...state.style, ...action.patch } } : state;

    case "setMember":
      return { ...state, memberId: action.id };

    case "addMember":
      return { ...state, input: { ...state.input, members: [...state.input.members, action.member] }, memberId: action.member.id };

    case "removeMember": {
      const target = state.input.members.find(m => m.id === action.id);
      if (!target) return state;
      // A set is exactly one birthday kid plus family, so the kid can never be dropped.
      if (target.kind === "birthday-kid" && state.input.members.filter(m => m.kind === "birthday-kid").length <= 1) return state;
      const members = state.input.members.filter(m => m.id !== action.id);
      return {
        ...state,
        input: { ...state.input, members },
        memberId: state.memberId === action.id ? members[0].id : state.memberId,
      };
    }

    case "updateMember":
      return { ...state, input: mapMembers(state.input, m => m.id === action.id, m => ({ ...m, ...action.patch })) };

    case "patchLayer": {
      const { layerId, scope, patch } = action;
      const { font, color, stroke, ...rest } = patch;
      const override: Record<string, unknown> = { ...rest };
      let style = state.style;

      if (scope === "set" && style) {
        if (font !== undefined) style = { ...style, font };
        if (color !== undefined) {
          // The numeral is the only slot drawn in the secondary ink; everything else is primary.
          const slot = layerId === "numeral" ? "secondary" : "primary";
          style = { ...style, palette: { ...style.palette, [slot]: color } };
        }
        if (stroke !== undefined) {
          if (layerId === "numeral") style = { ...style, palette: { ...style.palette, outline: stroke.color } };
          // The palette has no room for a stroke width, so the stroke also rides along as an override.
          override.stroke = stroke;
        }
      } else {
        if (font !== undefined) override.font = font;
        if (color !== undefined) override.color = color;
        if (stroke !== undefined) override.stroke = stroke;
      }

      const touched = scope === "set" ? () => true : (m: Member) => m.id === action.memberId;
      return { ...state, style, input: mapMembers(state.input, touched, m => withOverride(m, layerId, override)) };
    }

    case "resetOverride":
      return {
        ...state,
        input: mapMembers(state.input, m => m.id === action.memberId, m => {
          if (!m.overrides?.[action.layerId]) return m;
          const rest = { ...m.overrides };
          delete rest[action.layerId];
          return Object.keys(rest).length ? { ...m, overrides: rest } : { ...m, overrides: undefined };
        }),
      };

    case "loaded":
      return { ...state, style: action.style };
  }
}

/** Members whose design has a layer outside the safe area — the ones Export is waiting on. */
export function unsafeMemberIds(designs: ReadonlyMap<string, Design> | null): string[] {
  if (!designs) return [];
  return [...designs].filter(([, d]) => !isWithinSafeArea(d)).map(([id]) => id);
}

/** The sentence that names them, so a warning off the open tab is still readable. */
export function safetyWarning(members: readonly Member[], unsafeIds: readonly string[]): string | null {
  const labels = members.filter(m => unsafeIds.includes(m.id)).map(m => m.label.trim() || "tanpa nama");
  if (!labels.length) return null;
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} dan ${labels[labels.length - 1]}` : labels[0];
  return `Desain ${list} keluar dari area aman`;
}

/** Intrinsic pixel size of an image URL — the collage needs it to keep the clipart's aspect ratio. */
export function useImageSize(src: string | null | undefined) {
  // Keyed by source so a new clipart reports `null` on the render it changes, without a setState
  // in the effect body that would cost an extra render pass.
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (alive) setLoaded({ src, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return loaded && loaded.src === src ? { w: loaded.w, h: loaded.h } : null;
}

export type Initial = { id: string; input: SetInput; style: SetStyle | null };

export type SaveStatus = "saved" | "saving" | "pending" | "invalid" | "error";

/** Injected by the page so this module stays free of server-action imports (and node-testable). */
export type EditorDeps = {
  save?: (id: string, patch: { input: SetInput; style?: SetStyle }) => Promise<void>;
  onError?: (message: string) => void;
};

const AUTOSAVE_MS = 800;

export function useSetEditor(initial: Initial, deps: EditorDeps = {}) {
  const [state, dispatch] = useReducer(reducer, initial, i => ({
    id: i.id,
    input: i.input,
    style: i.style,
    memberId: i.input.members[0].id,
  }));
  const [selected, setSelected] = useState<string | null>(null);
  const measure = useBrowserMeasurer();
  const clipart = useImageSize(state.style?.clipartSrc ?? state.input.clipartSrc);

  // A clipart with no style yet gets the starter style, so the canvas is never blank while waiting
  // on the AI — and an export works without one.
  useEffect(() => {
    if (state.style) return;
    const starter = starterStyle(state.input);
    if (starter) dispatch({ type: "loaded", style: starter });
  }, [state.style, state.input]);

  const { designs, error } = useMemo(() => {
    if (!measure || !clipart || !state.style) return { designs: null, error: null };
    try {
      const list = expand({ input: state.input, style: state.style }, { measure, clipart });
      return { designs: new Map(list.map(d => [d.memberId, d.design])), error: null };
    } catch {
      return { designs: null, error: "Ada layer dengan ukuran tidak masuk akal. Klik Reset override." };
    }
  }, [state.input, state.style, measure, clipart]);

  const design: Design | null = designs?.get(state.memberId) ?? null;
  const unsafeIds = useMemo(() => unsafeMemberIds(designs), [designs]);
  const warning = useMemo(() => safetyWarning(state.input.members, unsafeIds), [state.input.members, unsafeIds]);
  const valid = useMemo(() => SetInputSchema.safeParse(state.input).success, [state.input]);

  // Autosave: 800 ms after the last edit. An input that would fail the schema (a cleared name, say)
  // is never sent — the server would only reject it — and the header says so instead.
  const payload = useMemo(() => JSON.stringify({ input: state.input, style: state.style }), [state.input, state.style]);
  const [saved, setSaved] = useState(payload);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dirty = payload !== saved;

  const { save, onError } = deps;
  useEffect(() => {
    if (!dirty || !valid || !save) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        await save(state.id, { input: state.input, ...(state.style ? { style: state.style } : {}) });
        setSaved(payload);
        setFailed(false);
      } catch (e) {
        setFailed(true);
        onError?.(e instanceof Error ? e.message : "Gagal menyimpan perubahan.");
      } finally {
        setSaving(false);
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [payload, dirty, valid, save, onError, state.id, state.input, state.style]);

  const status: SaveStatus = !valid ? "invalid" : saving ? "saving" : failed ? "error" : dirty ? "pending" : "saved";

  return {
    state,
    dispatch,
    designs,
    design,
    unsafeIds,
    warning,
    error,
    valid,
    dirty,
    status,
    selected,
    setSelected,
    memberId: state.memberId,
    setMemberId: (id: string) => dispatch({ type: "setMember", id }),
  };
}
