/** PostgREST / supabase-js `throw error` is often a plain `{ message, code }` object. */
export function caughtErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
