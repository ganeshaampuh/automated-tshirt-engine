import { describe, it, expect } from "vitest";
import { initialStates, setMemberState, rollUp, allReady } from "@/lib/memberState";

describe("member state", () => {
  it("starts every member queued", () => {
    expect(initialStates(["a", "b"])).toEqual({ a: { status: "queued" }, b: { status: "queued" } });
  });
  it("patches one member without touching the others", () => {
    const s = setMemberState(initialStates(["a", "b"]), "a", { status: "ready", previewUrl: "u", widthCm: 24.1 });
    expect(s.a).toEqual({ status: "ready", previewUrl: "u", widthCm: 24.1 });
    expect(s.b).toEqual({ status: "queued" });
  });
  it("does not mutate its input", () => {
    const before = initialStates(["a"]);
    setMemberState(before, "a", { status: "failed", error: "x" });
    expect(before.a.status).toBe("queued");
  });
  it("ignores a patch for an unknown member", () => {
    const s = initialStates(["a"]);
    expect(setMemberState(s, "zzz", { status: "ready" })).toEqual(s);
  });
  it("rolls up counts and readiness", () => {
    let s = initialStates(["a", "b", "c"]);
    s = setMemberState(s, "a", { status: "ready" });
    s = setMemberState(s, "b", { status: "failed", error: "bad clipart" });
    expect(rollUp(s)).toEqual({ total: 3, ready: 1, failed: 1, queued: 1 });
    expect(allReady(s)).toBe(false);
    s = setMemberState(setMemberState(s, "b", { status: "ready", error: undefined }), "c", { status: "ready" });
    expect(allReady(s)).toBe(true);
  });
});
