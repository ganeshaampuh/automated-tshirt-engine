/**
 * A status as a small tinted chip, so a list of thirty reads by colour before it is read by word.
 *
 * Server-safe (no hooks): the home page's rows and cards are server-rendered.
 */
export type Tone = "quiet" | "busy" | "good" | "bad";

const SKIN: Record<Tone, string> = {
  // Outlined rather than filled: rows sit on the bench and cards on white, and a fill matching either vanishes on it.
  quiet: "ring-1 ring-inset ring-rule text-muted",
  busy: "bg-tape/15 text-tape-dark",
  good: "bg-mat/10 text-mat",
  bad: "bg-alert/10 text-alert",
};

/**
 * Which tone each set or batch status wears. Covers both vocabularies (`@/lib/statusLabel`), since
 * they share most words.
 */
export function statusTone(status: string): Tone {
  switch (status) {
    case "queued":
    case "processing":
    case "exporting":
      return "busy";
    case "ready":
    case "approved":
    case "exported":
      return "good";
    case "failed":
      return "bad";
    default:
      return "quiet";
  }
}

export function StatusChip({ status, label, testId }: { status: string; label: string; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-display text-[11px] leading-tight ${SKIN[statusTone(status)]}`}>
      {label}
    </span>
  );
}
