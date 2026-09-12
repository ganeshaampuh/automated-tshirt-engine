"use client";
import dynamic from "next/dynamic";
import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { collage, setFonts, type Language } from "@/engine";
import { useBrowserMeasurer } from "@/engine/render/browser/useBrowserMeasurer";
import { CLIPART_SIZE, unicornSet } from "@/lib/fixtures/unicornSet";

// react-konva touches `window` at import time, so it must never run on the server.
const DesignStage = dynamic(() => import("@/engine/render/browser/DesignStage").then(m => m.DesignStage), { ssr: false });

const SCALE = 0.2;

function Parity() {
  const params = useSearchParams();
  const memberId = params.get("member") ?? "ayah";
  const language = (params.get("lang") === "id" ? "id" : "en") as Language;
  const set = useMemo(() => unicornSet(language), [language]);
  // The parity screenshot is compared with the server render pixel for pixel, so the fixture's own
  // faces are exactly the ones that must be in the browser before anything is measured.
  const measure = useBrowserMeasurer(setFonts(set.input, set.style));
  const [ready, setReady] = useState(false);

  const design = useMemo(() => {
    if (!measure) return null;
    const member = set.input.members.find(m => m.id === memberId);
    if (!member) return null;
    return collage(set, member, { measure, clipart: CLIPART_SIZE });
  }, [measure, set, memberId]);

  if (!design) return <div data-testid="stage" />;
  return (
    <>
      {/* The goldens are transparent PNGs; a page background would make `omitBackground` opaque. */}
      <style>{"html,body{background:transparent!important;margin:0}"}</style>
      {/* `data-ready` only flips once the clipart has loaded and been drawn, so a screenshot taken
          on that signal can never catch a stage that is still missing an image. */}
      <div data-testid="stage" data-ready={ready ? "1" : "0"} style={{ width: "fit-content" }}>
        <DesignStage design={design} scale={SCALE} background={null} onReady={() => setReady(true)} />
      </div>
    </>
  );
}

export default function ParityPage() {
  // Dev-only harness: the browser renderer is compared against the server goldens here.
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<div data-testid="stage" />}>
      <Parity />
    </Suspense>
  );
}
