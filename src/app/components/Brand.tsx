import Link from "next/link";

/** A flat tee, drawn on a 24-unit grid. Shared by the brand mark and the set list's colour swatch. */
export function ShirtGlyph({ fill = "currentColor", stroke, className = "" }: { fill?: string; stroke?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        d="M8.2 3 4.3 4.9 2 9.2l3.2 1.6 1-1V21h11.6V9.8l1 1L22 9.2l-2.3-4.3L15.8 3c-.6 1.5-2 2.4-3.8 2.4S8.8 4.5 8.2 3Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke ? 1.1 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The product's mark: a tape-orange tee on a square of cutting mat, the two colours the whole bench
 * is built from. `onMat` is for the home hero, where the wordmark sits on the green itself.
 */
export function Brand({ onMat = false }: { onMat?: boolean }) {
  return (
    <Link href="/" className={`inline-flex shrink-0 items-center gap-2 font-display text-[15px] font-medium ${onMat ? "text-white" : "text-ink"}`}>
      <span className={`grid size-7 place-items-center rounded-[var(--radius-ctl)] ${onMat ? "bg-white/10" : "bg-mat"}`}>
        <ShirtGlyph className="size-[18px] text-tape" />
      </span>
      Kaos Ulang Tahun
    </Link>
  );
}
