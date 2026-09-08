/**
 * The shape every Server Action returns.
 *
 * React replaces a message thrown out of a Server Action with a generic English sentence in a
 * production build, so an expected failure — a missing set, a rejected upload, a provider that is
 * down — has to travel back as *data* if the shop is ever to read its Indonesian wording. Only a
 * genuinely unexpected fault is left to throw and hit the error boundary.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** An expected failure. Thrown inside an action body and turned into `{ ok: false }` by `action`. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

/** Wraps a Server Action body: `ActionError` becomes a result, anything else keeps throwing. */
export async function action<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, message: e.message };
    throw e;
  }
}

/** The toast for a fault no action anticipated — the thrown message is unreadable in production. */
export const UNEXPECTED_MESSAGE = "Terjadi kesalahan tak terduga. Coba lagi.";
