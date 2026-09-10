/**
 * Post-login redirect target. Only a same-origin path survives: it must start with a
 * single "/" not followed by "/" or "\" (browsers treat "//host" and "/\host" as
 * off-site), and carry no control characters (browsers strip tab/newline, so
 * "/\t/host" would collapse to "//host"). Anything else falls back to "/".
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!/^\/(?![\/\\])/.test(next) || /[\x00-\x1f\x7f]/.test(next)) return "/";
  return next;
}
