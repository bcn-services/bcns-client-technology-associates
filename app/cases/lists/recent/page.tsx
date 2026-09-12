import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { ACTIVITY_DAYS, firmToday, recentActivity } from "@/lib/cases/presets";
import { Back, CaseLink, ErrorNote, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function RecentActivityPage() {
  await requireSession();
  const db = createServerClient();
  const [result] = await Promise.all([recentActivity(db, firmToday(new Date()))]);
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <Back />
      <h1 className="text-xl font-semibold">Recent activity</h1>
      <p className="text-sm text-slate-600">Case status changes and service authorizations in the last {ACTIVITY_DAYS} days, newest first.</p>
      {"error" in result ? <ErrorNote message={result.error} />
        : !result.rows.length ? <p className="text-sm text-slate-600">No activity in the last {ACTIVITY_DAYS} days.</p>
        : <Table testId="recent-activity" head={["Date", "Case #", "Activity"]}
            rows={result.rows.map((r) => ({ key: `${r.kind}-${r.caseid}-${r.srvauthid ?? ""}`,
              cells: [r.actionDate.slice(0, 10), <CaseLink key="id" id={r.caseid} />, r.description] }))} />}
    </main>
  );
}
