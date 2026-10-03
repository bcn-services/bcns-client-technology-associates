import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/env";
import { publicUrl } from "@/lib/public-url";
import { ACTOR_HEADER } from "@/lib/db/actor";

/** Exact paths reachable without a session. Never a prefix match. */
// /signout is public so an expired tab's sign-out still clears cookies instead of bouncing to a 405.
const PUBLIC_PATHS = new Set(["/login", "/api/health", "/signout"]);

/** Upper bound on the session lookup. A hung Supabase must deny, not stall the app. */
const SESSION_TIMEOUT_MS = 2000;

type MinimalClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => any;
};

/** A Supabase client plus the response its cookie writer keeps up to date. */
type Bound = { client: MinimalClient; response: () => NextResponse };

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("session lookup timed out")), SESSION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Route gate. `bind` is injectable so the gate is testable without network;
 * `null` means Supabase is unconfigured, which fails closed like any other denial.
 */
export async function gate(
  request: NextRequest,
  bind: (request: NextRequest) => Bound | null,
): Promise<NextResponse> {
  // The actor header is trusted downstream (lib/db/client.ts → audit_log.actor), so only
  // this gate may set it: drop any client-sent copy before anything is forwarded.
  request.headers.delete(ACTOR_HEADER);
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next({ request });

  const login = publicUrl("/login", request);
  const { pathname, search } = request.nextUrl;
  // A protocol-relative pathname ("//evil.com") would hand the login page an
  // off-site redirect target. Such a path gets no `next` at all — never a rewrite.
  if (/^\/(?!\/)/.test(pathname)) login.searchParams.set("next", pathname + search);

  let bound: Bound | null = null;
  const deny = () => {
    // 303 for a POST (e.g. a server action on an expired session): the browser loads /login
    // with a GET instead of replaying the form body at it. GET/HEAD keep the default 307.
    const safe = request.method === "GET" || request.method === "HEAD";
    const response = NextResponse.redirect(login, safe ? 307 : 303);
    // getUser() may have rotated the refresh token before we decided to deny.
    // Dropping those cookies leaves the browser holding a consumed token.
    if (bound) for (const cookie of bound.response().cookies.getAll()) response.cookies.set(cookie);
    return response;
  };

  // Fail closed: unconfigured, unreachable, timed out, or profile-less all deny.
  try {
    bound = bind(request);
    if (!bound) return deny();

    const { data } = await withTimeout(bound.client.auth.getUser());
    if (!data.user) return deny();

    // Mirrors lib/auth/session.ts: no profiles row with an admin/staff role ⇒ no session.
    // Parity is pinned by tests/app-shell/role-parity.test.mjs.
    const { data: profile } = await withTimeout<{ data: { role?: string | null } | null }>(
      bound.client.from("profiles").select("role").eq("id", data.user.id).maybeSingle(),
    );
    if (profile?.role !== "admin" && profile?.role !== "staff") return deny();

    // Forward the verified user id to the app; keep any cookies getUser() refreshed.
    request.headers.set(ACTOR_HEADER, data.user.id);
    const response = NextResponse.next({ request });
    for (const cookie of bound.response().cookies.getAll()) response.cookies.set(cookie);
    return response;
  } catch {
    return deny();
  }
}

/** Canonical @supabase/ssr middleware binding over the request/response cookie pair. */
export function bindSupabase(request: NextRequest): Bound | null {
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  let response = NextResponse.next({ request });
  const client = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  return { client: client as unknown as MinimalClient, response: () => response };
}

export function middleware(request: NextRequest): Promise<NextResponse> {
  return gate(request, bindSupabase);
}

export const config = {
  matcher: [
    // Every exclusion is a literal, dot-escaped and terminated. A pattern here
    // (an unescaped dot, an unterminated prefix, a file-extension clause) lets a
    // request steer around the app's only auth boundary.
    // /login and /api/health are matched, then allowlisted in PUBLIC_PATHS.
    "/((?!_next/static/|_next/image$|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$).*)",
  ],
};
