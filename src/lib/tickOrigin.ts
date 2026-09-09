/**
 * The absolute origin the batch pipeline calls itself on.
 *
 * A Server Action is a public POST, so `x-forwarded-host` and `x-forwarded-proto` are attacker
 * input: honouring them lets anyone who can upload a valid CSV aim the kick at an address of their
 * choosing (`169.254.169.254`, an origin they own). Next's Server Action origin check does not help,
 * because it compares `Origin` against that same forged host.
 *
 * So the precedence is inverted from the obvious one: a value the platform sets always wins, and the
 * request's own headers are consulted only under `next dev`, where there is no proxy to forge
 * through. With neither available the caller gets "" and skips the kick — the batch is already
 * durable and "Lanjutkan" starts a fresh chain, which is cheaper than an open redirect into a fetch.
 */
export type OriginEnv = {
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
  NODE_ENV?: string;
};

export type RequestHost = { host?: string | null; proto?: string | null };

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/;

/** Vercel sets these without a scheme; they are always https. */
const trusted = (env: OriginEnv) => env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL ?? "";

export function tickOrigin(env: OriginEnv, headers: RequestHost = {}): string {
  const platform = trusted(env).trim();
  if (platform !== "") return platform.startsWith("http") ? platform : `https://${platform}`;

  if (env.NODE_ENV !== "development") return "";

  const host = headers.host?.trim();
  if (!host) return "";
  const proto = headers.proto?.trim() || (LOOPBACK.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
