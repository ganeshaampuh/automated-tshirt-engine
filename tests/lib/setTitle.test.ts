import { describe, it, expect } from "vitest";
import { setTitle, BROKEN_TITLE } from "@/lib/setTitle";

describe("setTitle", () => {
  it("shows the child's name when the set has no name of its own", () => {
    expect(setTitle({ kidName: "Keisya" })).toEqual({ title: "Keisya", subtitle: undefined });
  });

  it("shows the shop's name, keeping the child's as the subtitle", () => {
    // The shop still has to see whose birthday an order is for, so naming a set must not hide it.
    expect(setTitle({ kidName: "Keisya", name: "Pesanan Bu Rina" }))
      .toEqual({ title: "Pesanan Bu Rina", subtitle: "Keisya" });
  });

  it("never repeats one name on both lines", () => {
    expect(setTitle({ kidName: "Keisya", name: "Keisya" })).toEqual({ title: "Keisya", subtitle: undefined });
  });

  it("treats a blank name as no name", () => {
    // A name that is only spaces reaches this from a form field the shop tabbed through.
    expect(setTitle({ kidName: "Keisya", name: "   " })).toEqual({ title: "Keisya", subtitle: undefined });
    expect(setTitle({ kidName: "Keisya", name: "" })).toEqual({ title: "Keisya", subtitle: undefined });
  });

  it("trims a name before deciding anything about it", () => {
    expect(setTitle({ kidName: "Keisya", name: "  Pesanan Bu Rina  " }))
      .toEqual({ title: "Pesanan Bu Rina", subtitle: "Keisya" });
    // ...including whether it is the child's name again
    expect(setTitle({ kidName: "Keisya", name: "  Keisya  " })).toEqual({ title: "Keisya", subtitle: undefined });
  });

  it("marks a set whose stored input would not parse", () => {
    // The row still has to render: a list that throws on one bad set shows the shop nothing at all.
    expect(setTitle(null)).toEqual({ title: BROKEN_TITLE, subtitle: undefined });
  });
});
