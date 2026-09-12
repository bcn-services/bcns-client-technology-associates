import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSession, type Session } from "@/lib/auth/session";
import { SECTIONS } from "@/lib/auth/sections";
import { RunningIndicator } from "@/app/time/running-indicator";

export const metadata: Metadata = {
  title: "Technology Associates",
  description: "Technology Associates client app.",
};

// Fail closed: any error reading the session renders no identity and no nav.
async function safeSession(): Promise<Session | null> {
  try {
    return await getSession();
  } catch {
    return null;
  }
}

const navLink = "rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900";

function Header({ session }: { session: Session }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold text-slate-900">
          Technology Associates
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className={navLink}>
              {s.label}
            </Link>
          ))}
          <Link href="/account" className={navLink}>
            Account
          </Link>
          <RunningIndicator />
          {/* Server-side decision: staff markup never contains this link. */}
          {session.role === "admin" && (
            <Link href="/users" className={navLink}>
              Users
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>
            <span data-testid="session-email">{session.email}</span> ·{" "}
            <span data-testid="session-role">{session.role}</span>
          </span>
          <form method="post" action="/signout">
            <button type="submit" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await safeSession();
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">
        {session && <Header session={session} />}
        <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
