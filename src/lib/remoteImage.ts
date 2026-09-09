import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The one door through which this app fetches a URL it did not construct itself.
 *
 * Batch mode feeds it addresses straight out of a spreadsheet, so every hop is treated as hostile:
 * https only, no credentials, no odd ports, the host must resolve to public address space, the
 * check is repeated after every redirect, and the body is capped while it streams.
 *
 * Messages are shown to the shop, so they stay short Indonesian sentences and never name a
 * resolved IP address — that would turn an error message into a port scanner.
 */
export class RemoteImageError extends Error {
  constructor(message: string) { super(message); this.name = "RemoteImageError"; }
}

export const MAX_REMOTE_BYTES = 16 * 1024 * 1024;
export const REMOTE_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 3;

export type DnsLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: DnsLookup = async host =>
  (await dnsLookup(host, { all: true, verbatim: true })).map(a => a.address);

const toInt = (ip: string) => ip.split(".").reduce((n, o) => (n * 256 + Number(o)) >>> 0, 0) >>> 0;
const inNet = (ip: string, net: string, bits: number) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(net) & mask) >>> 0);
};

/** Expands any IPv6 spelling (`::` compression, trailing dotted quad) into its eight hextets. */
function hextets(ip: string): number[] | null {
  let s = ip;
  const dotted = /:((\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const n = toInt(dotted[1]);
    s = s.slice(0, dotted.index + 1) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return null;
  const part = (t: string) => (t === "" ? [] : t.split(":").map(h => parseInt(h, 16)));
  const a = part(head), b = tail === undefined ? [] : part(tail);
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill(0), ...b];
  if (groups.length !== 8 || groups.some(g => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function isBlockedV4(ip: string): boolean {
  return (
    inNet(ip, "0.0.0.0", 8) ||          // "this network", includes the unspecified address
    inNet(ip, "10.0.0.0", 8) ||         // private
    inNet(ip, "100.64.0.0", 10) ||      // CGNAT
    inNet(ip, "127.0.0.0", 8) ||        // loopback
    inNet(ip, "169.254.0.0", 16) ||     // link-local — cloud metadata lives here
    inNet(ip, "172.16.0.0", 12) ||      // private
    inNet(ip, "192.0.0.0", 24) ||       // IETF protocol assignments
    inNet(ip, "192.168.0.0", 16) ||     // private
    inNet(ip, "198.18.0.0", 15) ||      // benchmarking
    inNet(ip, "224.0.0.0", 4) ||        // multicast
    inNet(ip, "240.0.0.0", 4) ||        // reserved, and 255.255.255.255 with it
    ip === "255.255.255.255"
  );
}

export function isBlockedAddress(raw: string): boolean {
  const ip = raw.trim().toLowerCase();
  if (isIP(ip) === 4) return isBlockedV4(ip);
  if (isIP(ip) === 6) {
    const h = hextets(ip);
    if (!h) return true;
    const zeroTop = h.slice(0, 5).every(g => g === 0);
    // An IPv4 address wearing an IPv6 hat — mapped, compatible or NAT64 — is judged as IPv4.
    const embedded =
      (zeroTop && h[5] === 0xffff) ||                       // ::ffff:a.b.c.d
      (h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every(g => g === 0)) || // 64:ff9b::/96
      (zeroTop && h[5] === 0 && !(h[6] === 0 && h[7] <= 1)); // ::a.b.c.d (but not :: or ::1)
    if (embedded) {
      const v4 = [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join(".");
      return isBlockedV4(v4);
    }
    if (h.every(g => g === 0)) return true;                        // ::
    if (zeroTop && h[6] === 0 && h[7] === 1) return true;          // ::1
    if ((h[0] & 0xfe00) === 0xfc00) return true;                   // fc00::/7 unique local
    if ((h[0] & 0xffc0) === 0xfe80) return true;                   // fe80::/10 link-local
    if ((h[0] & 0xff00) === 0xff00) return true;                   // ff00::/8 multicast
    return false;
  }
  return true; // not an address we can reason about
}

export function assertPublicHost(hostname: string, addresses: string[]): void {
  if (addresses.length === 0) throw new RemoteImageError(`Alamat ${hostname} tidak bisa ditemukan.`);
  // Every answer must be public: one private record is enough to make the host unsafe.
  if (addresses.some(isBlockedAddress)) throw new RemoteImageError(`Alamat ${hostname} tidak diizinkan.`);
}

/** `URL.hostname` keeps IPv6 in brackets and may carry a `%25zone`; both are stripped here. */
function bareHost(hostname: string): string {
  const inner = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return inner.replace(/%25.*$/i, "").replace(/%.*$/, "");
}

/** Resolves the host unless it is already a literal address, then refuses anything non-public. */
async function checkHost(parsed: URL, lookup: DnsLookup): Promise<void> {
  const host = bareHost(parsed.hostname);
  // A bracketed literal with a zone id (`[fe80::1%25eth0]`) is not something DNS can answer for,
  // and it is exactly how someone reaches a link-local interface — judge the literal directly.
  if (parsed.hostname.startsWith("[") || isIP(host)) {
    if (!isIP(host) || isBlockedAddress(host)) throw new RemoteImageError(`Alamat ${parsed.hostname} tidak diizinkan.`);
    return;
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new RemoteImageError(`Alamat ${host} tidak bisa ditemukan.`);
  }
  assertPublicHost(host, addresses);
}

export async function fetchRemoteImage(url: string, opts: { fetchFn?: typeof fetch; lookup?: DnsLookup } = {}): Promise<Buffer> {
  const doFetch = opts.fetchFn ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { throw new RemoteImageError("Alamat gambar tidak valid."); }
    if (parsed.protocol !== "https:") throw new RemoteImageError("Alamat gambar harus memakai https.");
    // Credentials in the URL are never needed for a public image and are a classic way to confuse
    // a parser about which host is really being reached.
    if (parsed.username || parsed.password) throw new RemoteImageError("Alamat gambar tidak boleh memuat sandi.");
    if (parsed.port && parsed.port !== "443") throw new RemoteImageError("Alamat gambar harus memakai port standar.");
    // Resolve and check on EVERY hop: a redirect is a fresh, unvetted destination.
    await checkHost(parsed, lookup);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await doFetch(current, { redirect: "manual", signal: ctrl.signal, headers: { accept: "image/*" } });
      } catch {
        throw new RemoteImageError("Gagal mengambil gambar dari alamat itu.");
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new RemoteImageError("Gagal mengambil gambar dari alamat itu.");
        try { current = new URL(location, current).toString(); }
        catch { throw new RemoteImageError("Alamat gambar tidak valid."); }
        continue;
      }
      if (!res.ok) throw new RemoteImageError(`Gambar tidak bisa diambil (${res.status}).`);

      const type = res.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("image/")) throw new RemoteImageError("Alamat itu bukan gambar.");
      const declared = Number(res.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES) throw new RemoteImageError("Gambar terlalu besar.");

      // The timeout stays armed through the body: a socket that trickles bytes forever is a hang.
      return await readCapped(res);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RemoteImageError("Terlalu banyak pengalihan alamat.");
}

/** Reads the body a chunk at a time so a lying `content-length` cannot blow past the cap. */
async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) throw new RemoteImageError("Gambar kosong.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); } catch { throw new RemoteImageError("Gagal mengambil gambar dari alamat itu."); }
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_REMOTE_BYTES) { await reader.cancel(); throw new RemoteImageError("Gambar terlalu besar."); }
    chunks.push(chunk.value);
  }
  if (total === 0) throw new RemoteImageError("Gambar kosong.");
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}
