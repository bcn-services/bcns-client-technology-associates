import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { waitingFor } from "@/lib/cases/presets";
import { Back, CaseLink, ErrorNote, Table } from "../ui";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default async function WaitingForPage() {
  await requireSession();
  const db = createServerClient();
  const [result] = await Promise.all([waitingFor(db)]);
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <Back />
      <h1 className="text-xl font-semibold">Waiting For</h1>
      {"error" in result ? <ErrorNote message={result.error} />
        : !result.rows.length ? <p className="text-sm text-slate-600">No cases are waiting on an initial advance or case material.</p>
        : <Table testId="waiting-for" head={["Case #", "Title", "Waiting for", "Start date", "Event date", "Description", "Event description", "Funds received"]}
            rows={result.rows.map((r) => ({ key: r.caseid, cells: [<CaseLink key="id" id={r.caseid} />, r.casetitle, r.casestatwaitingfor, r.casestartdate,
              r.casestatduedate, r.casestatdescription, r.casestatduedatedescription, money.format(r.funds)] }))} />}
    </main>
  );
}
