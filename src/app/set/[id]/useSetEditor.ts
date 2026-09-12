"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  DEFAULT_FONT,
  SetInputSchema,
  defaultWording,
  expand,
  isWithinSafeArea,
  setFonts,
  type Design,
  type ImageLayer,
  type Member,
  type SetInput,
  type SetStyle,
  type TextLayer,
  type Wording,
} from "@/engine";
import { useBrowserMeasurer } from "@/engine/render/browser/useBrowserMeasurer";
import { initialHistory, withHistory } from "./history";
import { UNEXPECTED_MESSAGE, type ActionResult } from "@/lib/actionResult";

/** Layer fields an edit can write, in print px — the same shape `DesignStage` reports. */
export type LayerPatch = Partial<Omit<TextLayer, "id" | "type">> & Partial<Omit<ImageLayer, "id" | "type">>;

/** "set" spreads an edit across every member (and into the shared style); "member" keeps it local. */
export type Scope = "set" | "member";

/**
 * Where an edit lands for a shop that never touches the scope toggle.
 *
 * The open shirt, not the set: a nudge meant for one member that quietly moved four is work to
 * undo across four tabs, while a set-wide change the shop has to ask for costs one click on the
 * toggle. Default to the mistake that is cheap to recover from.
 */
export const DEFAULT_SCOPE: Scope = "member";

/** Where a reorder sends the layer, in the renderer's own direction: the last id is drawn on top. */
export type Move = "front" | "forward" | "backward" | "back";

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
  | { type: "reorderLayer"; memberId: string; layerId: string; move: Move; ids: string[]; scope: Scope }
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

/**
 * The stack after `layerId` makes `move`, or `null` when it is already at that end — the caller
 * turns that into "no change", so a click at the end of the stack costs no undo step.
 */
export function moved(ids: readonly string[], layerId: string, move: Move): string[] | null {
  const from = ids.indexOf(layerId);
  if (from < 0) return null;
  const to = move === "front" ? ids.length - 1 : move === "back" ? 0 : move === "forward" ? from + 1 : from - 1;
  if (to === from || to < 0 || to > ids.length - 1) return null;
  const rest = ids.filter(id => id !== layerId);
  return [...rest.slice(0, to), layerId, ...rest.slice(to)];
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

    case "reorderLayer": {
      // The order comes from the rendered stack the user is looking at, so a member with no stored
      // order of its own reorders from the template's.
      const order = moved(action.ids, action.layerId, action.move);
      if (!order) return state;
      const touched = action.scope === "set" ? () => true : (m: Member) => m.id === action.memberId;
      return { ...state, input: mapMembers(state.input, touched, m => ({ ...m, order })) };
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
  save?: (id: string, patch: { input: SetInput; style?: SetStyle }) => Promise<ActionResult<void>>;
  onError?: (message: string) => void;
};

const AUTOSAVE_MS = 800;

const historyReducer = withHistory(reducer);

export function useSetEditor(initial: Initial, deps: EditorDeps = {}) {
  const [history, dispatch] = useReducer(historyReducer, initial, i =>
    initialHistory({ id: i.id, input: i.input, style: i.style, memberId: i.input.members[0].id }),
  );
  const state = history.present;
  // Stable, so the editor's window-level keyboard listener is bound once rather than every render.
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const [selected, setSelected] = useState<string | null>(null);
  // Only the faces this set can draw with, so the first canvas never waits on the whole registry.
  const measure = useBrowserMeasurer(setFonts(state.input, state.style));
  const clipart = useImageSize(state.style?.clipartSrc ?? state.input.clipartSrc);

  // A clipart with no style yet gets the starter style, so the canvas is never blank while waiting
  // on the AI — and an export works without one.
  useEffect(() => {
    if (state.style) return;
    const starter = starterStyle(state.input);
    if (starter) dispatch({ type: "loaded", style: starter });
  }, [state.style, state.input]);

  const { designs, hiddenByMember, error } = useMemo(() => {
    if (!measure || !clipart || !state.style) return { designs: null, hiddenByMember: null, error: null };
    try {
      const list = expand({ input: state.input, style: state.style }, { measure, clipart });
      return {
        designs: new Map(list.map(d => [d.memberId, d.design])),
        hiddenByMember: new Map(list.map(d => [d.memberId, d.hidden])),
        error: null,
      };
    } catch {
      return { designs: null, hiddenByMember: null, error: "Ada layer dengan ukuran tidak masuk akal. Klik Reset override." };
    }
  }, [state.input, state.style, measure, clipart]);

  const design: Design | null = designs?.get(state.memberId) ?? null;
  // What the open tab has deleted — the only handle the shop has on a layer that is no longer drawn.
  const hidden: string[] = hiddenByMember?.get(state.memberId) ?? [];
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
        // An expected refusal comes back as data — a message thrown out of a Server Action is
        // replaced by React with a generic English sentence in production.
        const result = await save(state.id, { input: state.input, ...(state.style ? { style: state.style } : {}) });
        if (!result.ok) {
          setFailed(true);
          onError?.(result.message);
          return;
        }
        setSaved(payload);
        setFailed(false);
      } catch (e) {
        console.error(e);
        setFailed(true);
        onError?.(UNEXPECTED_MESSAGE);
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
    hidden,
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
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
