import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { SECTIONS } from "@/lib/auth/sections";

export default async function HomePage() {
  const session = await getSession().catch(() => null);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Technology Associates</h1>
        {session && (
          <p className="mt-1 text-slate-600">
            Signed in as {session.email} ({session.role}).
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <form method="get" action="/cases" role="search" className="flex gap-2">
          <label htmlFor="home-case-q" className="sr-only">Search cases</label>
          <input id="home-case-q" name="q" type="search" placeholder="Search cases" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2" />
          <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 hover:border-slate-400">Go</button>
        </form>
        <form method="get" action="/inquiries" role="search" className="flex gap-2">
          <label htmlFor="home-inquiry-q" className="sr-only">Search inquiries</label>
          <input id="home-inquiry-q" name="q" type="search" placeholder="Search inquiries" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2" />
          <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 hover:border-slate-400">Go</button>
        </form>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block rounded-lg border border-slate-200 bg-white px-4 py-3 font-medium text-slate-800 hover:border-slate-400"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
