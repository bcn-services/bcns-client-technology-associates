import Link from "next/link";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const PRESETS = [
  { href: "/cases/lists/work-status", label: "Work Status", note: "Prioritized open cases by point man" },
  { href: "/cases/lists/waiting-for", label: "Waiting For", note: "Cases waiting on initial advance or case material, with funds received" },
  { href: "/cases/lists/other-experts", label: "Other experts", note: "Search the other-experts field" },
  { href: "/cases/service-auths", label: "Service authorizations", note: "Unapproved, awaiting approval, recently approved, and totals" },
  { href: "/cases/lists/recent", label: "Recent activity", note: "Status changes and service authorizations, last 35 days" },
];

export default async function CaseListsPage() {
  await requireSession();
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Case lists</h1>
      <ul className="space-y-2">
        {PRESETS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="text-blue-700 hover:underline">{p.label}</Link>
            <span className="ml-2 text-sm text-slate-600">{p.note}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
