/**
 * An absolute URL on the address the browser used. Behind nginx the app listens on
 * 127.0.0.1:<port>, so request.url / request.nextUrl carry that internal origin and a
 * redirect built from them sends the browser to https://localhost:<port>. nginx passes
 * the public Host and X-Forwarded-Proto; its 00-default catch-all drops any Host the
 * vhost does not name, so Host is not attacker-chosen in production.
 */
export function publicUrl(path: string, request: Request): URL {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
  return new URL(path, host ? `${proto}://${host}` : request.url);
}
