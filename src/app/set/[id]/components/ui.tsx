"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { UNEXPECTED_MESSAGE, type ActionResult } from "@/lib/actionResult";

/* ---------- toasts ---------- */

type Toast = { id: number; message: string; tone: "ok" | "bad" };
type ToastApi = { show: (message: string, tone?: Toast["tone"]) => void };

const ToastCtx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const show = useCallback((message: string, tone: Toast["tone"] = "bad") => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, message, tone }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setItems(prev => prev.filter(t => t.id !== id));
    }, 5000);
    timers.current.add(timer);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(420px,90vw)] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
        {items.map(t => (
          <div
            key={t.id}
            data-testid="toast"
            className={`pointer-events-auto rounded-[var(--radius-ctl)] px-3 py-2 text-[13px] shadow-lg ${
              t.tone === "bad" ? "bg-alert text-white" : "bg-ink text-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- controls ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "quiet";
  pending?: boolean;
};

export function Button({ variant = "default", pending, className = "", children, disabled, ...rest }: ButtonProps) {
  const skin =
    variant === "primary"
      ? "bg-tape text-ink hover:bg-tape-dark hover:text-white border-transparent"
      : variant === "quiet"
        ? "border-transparent text-muted hover:text-ink hover:bg-bench"
        : "bg-panel border-rule text-ink hover:bg-bench";
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] border px-2.5 py-1.5 font-display text-[13px] leading-none transition-colors disabled:opacity-45 ${skin} ${className}`}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-display text-[12px] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-rule px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[13px] font-medium text-ink">{title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * Runs one async action at a time, tracks which one is pending and toasts its failure.
 *
 * An expected failure comes back as `{ ok: false }` with wording the shop can read; a throw means
 * something unforeseen, and in a production build its message is React's generic English sentence,
 * so it is logged and replaced.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const { show } = useToast();
  const run = useCallback(
    async (key: string, fn: () => Promise<ActionResult<unknown> | void>) => {
      setPending(key);
      try {
        const result = await fn();
        if (result && !result.ok) show(result.message);
      } catch (e) {
        console.error(e);
        show(UNEXPECTED_MESSAGE);
      } finally {
        setPending(null);
      }
    },
    [show],
  );
  return { pending, run };
}
