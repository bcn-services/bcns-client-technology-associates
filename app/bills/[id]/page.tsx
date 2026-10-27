import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getConfig } from "@/lib/env";
import { resolveLegacyFile } from "@/lib/documents/legacy";
import type { Db } from "@/lib/time/entries";
import { loadBill } from "@/lib/bills/edit";
import { brokenFinalize, storedLines } from "@/lib/bills/finalize";
import { noticeErrorMessage } from "@/lib/bills/notice";
import { advanceBillNotice, closeBillAs, createBillPdf, editBill, reviseBillAction } from "../actions";
import { BillView } from "./bill-view";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** One bill: every tblbills field, its case, attached time, revisions. Admins edit six columns in place. */
export default async function BillPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const id = Number(params.id);
  const db = createServerClient() as unknown as Db;
  const data = await loadBill(db, id);
  if (!data) notFound();
  const broken = !!data.bill.billfinalizedat && brokenFinalize(data.bill, await storedLines(db, id));
  // A legacy bill (no stored PDF) gets a "File name" link only when its NAS copy is really there; a fault just hides the link.
  const { billpdfpath, billfilename } = data.bill;
  const dir = getConfig().legacyDocsDir;
  const legacyFile = !billpdfpath && !!billfilename && !!dir
    && !!(await resolveLegacyFile(dir, "bill", billfilename).catch((e) => { console.error("bill legacy file:", id, e); return null; }));
  const admin = session.role === "admin";
  const error = first(searchParams.error);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Bill #{id}</h1>
      <BillView
        data={data}
        admin={admin}
        action={admin ? editBill.bind(null, id) : undefined}
        advance={admin ? advanceBillNotice.bind(null, id) : undefined}
        close={admin ? closeBillAs.bind(null, id) : undefined}
        revise={admin ? reviseBillAction.bind(null, id) : undefined}
        createPdf={admin ? createBillPdf.bind(null, id) : undefined}
        error={error ? noticeErrorMessage(error) : undefined}
        saved={first(searchParams.saved) === "1"}
        broken={broken}
        legacyFile={legacyFile}
      />
    </main>
  );
}
