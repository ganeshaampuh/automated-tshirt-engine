import { describe, it, expect, vi } from "vitest";
import { fetchRemoteImage, isBlockedAddress, assertPublicHost, RemoteImageError, MAX_REMOTE_BYTES } from "@/lib/remoteImage";

const png = Buffer.from("89504e470d0a1a0a", "hex");
const ok = (body: Buffer, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(body), { status: 200, headers: { "content-type": "image/png", "content-length": String(body.length), ...headers } });
const publicLookup = async () => ["93.184.216.34"];

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local, CGNAT and unspecified", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });
  it("allows ordinary public addresses", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700::1111", "2002:5db8:d822::1", "::ffff:0:5db8:d822"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it("blocks an IPv4-mapped address written in hex, and other reserved space", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a00:5", "::", "ff02::1", "240.0.0.1", "198.18.0.1", "192.0.0.1", "255.255.255.255", "64:ff9b::7f00:1", "2002:7f00:1::", "2002:a00:5::1", "::ffff:0:7f00:1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });
  it("blocks anything it cannot parse as an address", () => {
    for (const ip of ["", "not-an-ip", "999.1.1.1", "[::1]"]) expect(isBlockedAddress(ip), ip).toBe(true);
  });
});

describe("fetchRemoteImage", () => {
  it("rejects a non-https scheme", async () => {
    await expect(fetchRemoteImage("http://example.com/a.png", { lookup: publicLookup })).rejects.toBeInstanceOf(RemoteImageError);
    await expect(fetchRemoteImage("file:///etc/passwd", { lookup: publicLookup })).rejects.toBeInstanceOf(RemoteImageError);
  });

  it("rejects a host that resolves to a private address", async () => {
    await expect(fetchRemoteImage("https://evil.test/a.png", { lookup: async () => ["169.254.169.254"], fetchFn: vi.fn() }))
      .rejects.toThrow(/tidak diizinkan/i);
  });

  it("rejects when any resolved address is private, not just the first", async () => {
    await expect(fetchRemoteImage("https://evil.test/a.png", { lookup: async () => ["93.184.216.34", "127.0.0.1"], fetchFn: vi.fn() }))
      .rejects.toBeInstanceOf(RemoteImageError);
  });

  it("re-checks the host after a redirect", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://internal.test/a.png" } }));
    const lookup = vi.fn()
      .mockResolvedValueOnce(["93.184.216.34"])   // evil.test — looks fine
      .mockResolvedValueOnce(["10.0.0.5"]);        // internal.test — must be caught
    await expect(fetchRemoteImage("https://evil.test/a.png", { fetchFn, lookup })).rejects.toBeInstanceOf(RemoteImageError);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("stops after too many redirects", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://a.test/next.png" } }));
    await expect(fetchRemoteImage("https://a.test/a.png", { fetchFn, lookup: publicLookup })).rejects.toThrow(/pengalihan/i);
  });

  it("rejects a declared length over the cap", async () => {
    const fetchFn = vi.fn(async () => ok(png, { "content-length": String(MAX_REMOTE_BYTES + 1) }));
    await expect(fetchRemoteImage("https://a.test/a.png", { fetchFn, lookup: publicLookup })).rejects.toThrow(/terlalu besar/i);
  });

  it("rejects a body that exceeds the cap while streaming, even with no content-length", async () => {
    const big = new ReadableStream({
      start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); },
    });
    const fetchFn = vi.fn(async () => new Response(big, { status: 200, headers: { "content-type": "image/png" } }));
    await expect(fetchRemoteImage("https://a.test/a.png", { fetchFn, lookup: publicLookup })).rejects.toThrow(/terlalu besar/i);
  });

  it("rejects a non-image content type", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchRemoteImage("https://a.test/a.png", { fetchFn, lookup: publicLookup })).rejects.toThrow(/bukan gambar/i);
  });

  it("returns the bytes for a well-behaved public image", async () => {
    const fetchFn = vi.fn(async () => ok(png));
    expect(Buffer.compare(await fetchRemoteImage("https://a.test/a.png", { fetchFn, lookup: publicLookup }), png)).toBe(0);
  });

  // --- bypasses beyond the brief -------------------------------------------------

  it("rejects a redirect to a data: or file: url without fetching it", async () => {
    for (const location of ["data:image/png;base64,AAAA", "file:///etc/passwd", "http://169.254.169.254/latest/meta-data"]) {
      const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(fetchRemoteImage("https://a.test/a.png", { fetchFn, lookup: publicLookup })).rejects.toBeInstanceOf(RemoteImageError);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("checks a literal IP host itself instead of asking DNS", async () => {
    const lookup = vi.fn();
    await expect(fetchRemoteImage("https://127.0.0.1/a.png", { fetchFn: vi.fn(), lookup })).rejects.toBeInstanceOf(RemoteImageError);
    await expect(fetchRemoteImage("https://[::1]/a.png", { fetchFn: vi.fn(), lookup })).rejects.toBeInstanceOf(RemoteImageError);
    await expect(fetchRemoteImage("https://[fe80::1%25eth0]/a.png", { fetchFn: vi.fn(), lookup })).rejects.toBeInstanceOf(RemoteImageError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("allows a public literal IP host", async () => {
    const fetchFn = vi.fn(async () => ok(png));
    const lookup = vi.fn();
    expect(Buffer.compare(await fetchRemoteImage("https://93.184.216.34/a.png", { fetchFn, lookup }), png)).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a url that carries credentials", async () => {
    const fetchFn = vi.fn();
    await expect(fetchRemoteImage("https://user:pass@a.test/a.png", { fetchFn, lookup: publicLookup })).rejects.toBeInstanceOf(RemoteImageError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a non-default port", async () => {
    const fetchFn = vi.fn();
    await expect(fetchRemoteImage("https://a.test:9000/a.png", { fetchFn, lookup: publicLookup })).rejects.toBeInstanceOf(RemoteImageError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("never follows the redirect itself", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { void _url; void init; return ok(png); });
    await fetchRemoteImage("https://a.test/a.png", { fetchFn: fetchFn as unknown as typeof fetch, lookup: publicLookup });
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
});

describe("assertPublicHost", () => {
  it("names the host it refused without leaking the address", () => {
    expect(() => assertPublicHost("internal.test", ["10.0.0.1"])).toThrow(RemoteImageError);
    const message = (() => { try { assertPublicHost("internal.test", ["10.0.0.1"]); return ""; } catch (e) { return (e as Error).message; } })();
    expect(message).toContain("internal.test");
    expect(message).not.toContain("10.0.0.1");
  });
  it("refuses a host with no addresses at all", () => {
    expect(() => assertPublicHost("nowhere.test", [])).toThrow(RemoteImageError);
  });
  it("accepts a host whose every answer is public", () => {
    expect(() => assertPublicHost("cdn.test", ["93.184.216.34", "2606:4700::1111"])).not.toThrow();
  });
});
