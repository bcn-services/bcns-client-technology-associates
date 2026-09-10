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
