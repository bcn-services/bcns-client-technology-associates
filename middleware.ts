import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/env";

/** Exact paths reachable without a session. Never a prefix match. */
const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

type MinimalClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => any;
};

/** A Supabase client plus the response its cookie writer keeps up to date. */
type Bound = { client: MinimalClient; response: () => NextResponse };

/**
 * Route gate. `bind` is injectable so the gate is testable without network;
 * `null` means Supabase is unconfigured, which fails closed like any other denial.
 */
export async function gate(
  request: NextRequest,
  bind: (request: NextRequest) => Bound | null,
): Promise<NextResponse> {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const deny = () => NextResponse.redirect(login);

  // Fail closed: unconfigured, unreachable, or profile-less all deny.
  try {
    const bound = bind(request);
    if (!bound) return deny();

    const { data } = await bound.client.auth.getUser();
    if (!data.user) return deny();

    // Mirrors lib/auth/session.ts: no profiles row with an admin/staff role ⇒ no session.
    const { data: profile } = await bound.client
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.role !== "admin" && profile?.role !== "staff") return deny();

    return bound.response();
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
    // Everything except Next internals. Excluded prefixes are fixed literals only:
    // a general file-extension clause would match any path ending in that extension,
    // letting a dynamic segment (/cases/90001.js) steer around the gate entirely.
    // /login and /api/health are matched, then allowlisted in PUBLIC_PATHS.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
