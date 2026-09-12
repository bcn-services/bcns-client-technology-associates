import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/cases/record";
import { SA_LISTS, serviceAuthList, serviceAuthTotals, serviceAuthGrandTotal, type SaListKind, type SaListRow, type SaTotal } from "@/lib/cases/service-auths";
import { Back, CaseLink, ErrorNote, Table } from "../lists/ui";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const VIEWS = [...(Object.keys(SA_LISTS) as SaListKind[]), "totals"] as const;
type View = (typeof VIEWS)[number];

export default async function ServiceAuthsPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const raw = first(searchParams.view);
  const view: View = (VIEWS as readonly string[]).includes(raw ?? "") ? (raw as View) : "unapproved";
  const db = createServerClient() as unknown as Db;
  let rows: SaListRow[] = [], totals: SaTotal[] = [], failed = false;
  try {
    if (view === "totals") [totals] = await Promise.all([serviceAuthTotals(db)]);
    else [rows] = await Promise.all([serviceAuthList(db, view)]);
  } catch (e) {
    console.error("service-auths list:", e); // raw DB errors stay in the log
    failed = true;
  }
  const title = view === "totals" ? "Totals by status" : SA_LISTS[view].title;
  const tab = (v: View, label: string) => (
    <Link key={v} href={`/cases/service-auths?view=${v}`} aria-current={v === view ? "page" : undefined}
      className={`rounded border px-3 py-1 text-sm ${v === view ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 hover:bg-slate-100"}`}>{label}</Link>
  );
  const dateCol = view === "approved" ? "Approved" : "Auth date";

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <Back />
      <h1 className="text-xl font-semibold">Service authorizations: {title}</h1>
      <nav className="flex flex-wrap gap-2">
        {(Object.keys(SA_LISTS) as SaListKind[]).map((k) => tab(k, SA_LISTS[k].title))}
        {tab("totals", "Totals")}
      </nav>
      {view !== "totals" && <p className="text-sm text-slate-600">{SA_LISTS[view].note}.</p>}
      {failed ? <ErrorNote message="Couldn't load service authorizations. Try again." />
        : view === "totals"
          ? <Table testId="sa-totals" head={["Status", "Count", "Hours"]}
              rows={[...totals.map((t) => ({ key: t.status, cells: [t.status || "(blank)", t.count, t.hours] })),
                ((a) => ({ key: "__all", cells: [a.status, a.count, a.hours] }))(serviceAuthGrandTotal(totals))]} />
          : !rows.length ? <p className="text-sm text-slate-600">No service authorizations.</p>
          : <Table testId={`sa-${view}`} head={[dateCol, "Case #", "Title", "Branch", "Attorney", "Firm phone", "Status", "Hours"]}
              rows={rows.map((r) => ({ key: r.srvauthid, cells: [view === "approved" ? r.approvedDate : r.authDate, <CaseLink key="c" id={r.caseid} />, r.title, r.branch, r.attorney, r.firmPhone, r.status, r.hours] }))} />}
    </main>
  );
}
