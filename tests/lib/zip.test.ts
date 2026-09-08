import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { zipFiles } from "@/lib/zip";

describe("zipFiles", () => {
  it("round-trips", () => {
    const z = zipFiles([
      { name: "a.txt", data: Buffer.from("hi") },
      { name: "dir/b.bin", data: Buffer.from([1, 2, 3]) },
    ]);
    const out = unzipSync(new Uint8Array(z));
    expect(Buffer.from(out["a.txt"]).toString()).toBe("hi");
    expect([...out["dir/b.bin"]]).toEqual([1, 2, 3]);
  });
});
