/** Create bill: the form's inputs, the page's load, and the guarded two-step write (insert bill, then claim time rows). */
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { firmToday } from "@/lib/cases/presets";
import { fmtHours, isDate, thousandths } from "@/lib/time/week";
import { listCaseTime, type CaseTimeRow } from "@/lib/time/case";
import { BILL_TYPES, START_NOTICES, billFileName } from "./rules";
import { BALANCE_RE, BillInputError } from "./edit";

export type BillCreate = {
  billtype: string;
  billdate: string;
  billbalance: string;
  billnotice: string;
  billestimate: boolean;
  billcomments: string | null;
  actids: number[];
};

/** Parse the create form. No hours/total field is read — hours come from the DB rows of the checked actids. */
export function parseBillCreate(formData: FormData): BillCreate {
  const get = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)).trim() : "");
  const billtype = get("billtype");
  if (!BILL_TYPES.includes(billtype)) throw new BillInputError("type");
  const billdate = get("billdate");
  if (!isDate(billdate)) throw new BillInputError("date");
  // Finalize (item 3) computes the balance from the lines; typed here only as an optional placeholder, blank → 0.
  const billbalance = get("billbalance").replace(/,/g, "") || "0";
  if (!BALANCE_RE.test(billbalance)) throw new BillInputError("balance");
  const billnotice = get("billnotice") || "1st";
  if (!START_NOTICES.has(billnotice)) throw new BillInputError("notice");
  const raw = formData.getAll("actid").map(String);
  if (!raw.every((s) => /^\d{1,9}$/.test(s))) throw new BillInputError("stale");
  return {
    billtype,
    billdate,
    billbalance,
    billnotice,
    billestimate: get("billestimate") === "on",
    billcomments: get("billcomments") || null,
    actids: [...new Set(raw.map(Number))],
  };
}

/** `billingalert` / `billingcc` come from the case row for display only (cases lane owns them). */
export type NewBillData = { caseid: number; casetitle: string; billingalert: boolean; billingcc: string | null; rows: CaseTimeRow[]; today: string };

/** The case and its unbilled rows (actbilled = false AND actbillid is null); null when the case doesn't exist. */
export async function loadNewBill(db: Db, caseId: number, now: Date): Promise<NewBillData | null> {
  const k = await db.from("tblcase").select("caseid, casetitle, billingalert, billingcc").eq("caseid", caseId).maybeSingle();
  if (k.error) throw new Error(`tblcase read: ${k.error.message}`);
  if (!k.data) return null;
  const rows = (await listCaseTime(db, caseId)).filter((r) => r.actbilled === false && r.actbillid == null);
  return {
    caseid: caseId,
    casetitle: k.data.casetitle,
    billingalert: k.data.billingalert === true,
    billingcc: k.data.billingcc ?? null,
    rows,
    today: firmToday(now),
  };
}

/** `billfilename` for a new bill on `caseId` dated `billdate`: n = bills already on that case and date. */
export async function fileNameFor(db: Db, caseId: number, attyLastName: string | null | undefined, billdate: string): Promise<string | null> {
  const same = await db.from("tblbills").select("billid").eq("billcaseid", caseId).eq("billdate", billdate);
  if (same.error) throw new Error(`tblbills read: ${same.error.message}`);
  const last = attyLastName?.trim();
  // No attorney row → no file name (admin can set one on the bill page) rather than "Bill123  2026 ..." with a blank name.
  return last ? billFileName(caseId, last, billdate, (same.data ?? []).length) : null;
}

/**
 * Insert the bill, then claim the checked rows with a write guarded on `actbilled=false and actbillid is null`.
 * Claimed count ≠ checked count → revert rows pointing at the new bill, delete it, throw `stale`.
 * Returns the new billid.
 */
export async function createBill(db: Db, caseId: number, input: BillCreate): Promise<number> {
  const { actids } = input;
  const k = await db.from("tblcase").select("caseid, caseatty").eq("caseid", caseId).maybeSingle();
  if (k.error) throw new Error(`tblcase read: ${k.error.message}`);
  if (!k.data) throw new BillInputError("case");
  const atty = await db.from("tblattorney").select("attylastname").eq("attyid", k.data.caseatty).maybeSingle();
  if (atty.error) throw new Error(`tblattorney read: ${atty.error.message}`);

  // Hours from the DB rows of the checked ids, restricted to this case and still unbilled. A missing row → stale, nothing written.
  let hrs = 0;
  if (actids.length) {
    const r = await db.from("tblactivity").select("actid, acthrs").in("actid", actids).eq("actcaseid", caseId).eq("actbilled", false).is("actbillid", null);
    if (r.error) throw new Error(`tblactivity read: ${r.error.message}`);
    if ((r.data ?? []).length !== actids.length) throw new BillInputError("stale");
    hrs = (r.data as { acthrs: number | string }[]).reduce((t, a) => t + thousandths(a.acthrs), 0);
  }

  const billfilename = await fileNameFor(db, caseId, atty.data?.attylastname, input.billdate);

  const ins = await db.from("tblbills").insert({
    billcaseid: caseId,
    billdate: input.billdate,
    billhours: fmtHours(hrs), // text, so numeric(9,3) gets the exact thousandths sum
    billbalance: input.billbalance,
    billnotice: input.billnotice,
    billestimate: input.billestimate,
    billcomments: input.billcomments,
    billtype: input.billtype,
    billfilename,
  }).select("billid").single();
  if (ins.error || !ins.data) throw new Error(`tblbills insert: ${ins.error?.message ?? "no row"}`);
  const billid = ins.data.billid as number;
  if (!actids.length) return billid;

  const upd = await db.from("tblactivity")
    .update({ actbilled: true, actbillid: billid })
    .in("actid", actids).eq("actbilled", false).is("actbillid", null)
    .select("actid");
  if (upd.error || (upd.data ?? []).length !== actids.length) {
    // ponytail: compensation over PostgREST, not a transaction — a failure here leaves an orphan bill logged for manual cleanup
    const rev = await db.from("tblactivity").update({ actbilled: false, actbillid: null }).eq("actbillid", billid).select("actid");
    const del = await db.from("tblbills").delete().eq("billid", billid).select("billid");
    if (rev.error || del.error) console.error("createBill compensation failed:", billid, rev.error, del.error);
    if (upd.error) throw new Error(`tblactivity claim: ${upd.error.message}`);
    throw new BillInputError("stale");
  }
  return billid;
}

export type CreateDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => never;
};

/** Body of the `createBill` server action. Admin check first; staff → ?error=forbidden with no DB call. Redirects stay outside try. */
export async function runCreateBill(formData: FormData, deps: CreateDeps): Promise<void> {
  const rawCase = formData.get("caseid");
  const caseId = typeof rawCase === "string" && /^\d{1,9}$/.test(rawCase) ? Number(rawCase) : null;
  const back = (code: string) => `/bills/new?${caseId != null ? `case=${caseId}&` : ""}error=${code}`;
  let code: string | null = null;
  try {
    await deps.session();
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else throw e; // no-session redirect propagates
  }
  if (!code && caseId == null) code = "case";
  let billid = 0;
  if (!code) {
    try {
      billid = await createBill(deps.db(), caseId!, parseBillCreate(formData));
    } catch (e) {
      if (e instanceof BillInputError) code = e.code;
      else {
        console.error("createBill:", e);
        code = "failed";
      }
    }
  }
  if (code) deps.redirect(back(code));
  deps.revalidatePath(`/cases/${caseId}`);
  deps.redirect(`/bills/${billid}`);
}
