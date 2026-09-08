import { NextResponse } from "next/server";
import type { SetInput } from "@/engine";
import { createSet } from "@/app/actions/sets";

export const dynamic = "force-dynamic";

/**
 * A blank order sheet. `SetInputSchema` requires a name, a theme and one birthday kid, so the draft
 * starts with placeholders the shop overwrites in the first two fields rather than empty strings.
 *
 * This is a POST route handler, not a page: `createSet` revalidates, and Next refuses a write like
 * that during a render — and a draft row must not appear because something followed a link.
 */
const DRAFT: SetInput = {
  kidName: "Anak",
  age: 5,
  theme: "ulang tahun",
  language: "id",
  shirtColor: "#ffffff",
  members: [
    { id: "ayah", kind: "family", label: "Ayah", sizeClass: "adult" },
    { id: "mama", kind: "family", label: "Mama", sizeClass: "adult" },
    { id: "kid", kind: "birthday-kid", label: "Anak", sizeClass: "kids-1-9" },
  ],
};

export async function POST(request: Request) {
  const { id } = await createSet(DRAFT);
  // 303 so the browser follows with a GET; a 307 would repost to the editor page.
  return NextResponse.redirect(new URL(`/set/${id}`, request.url), 303);
}
