/**
 * Finalize a typed bill (billing-output item 3): load what the page prices from, then save the admin's lines
 * with `billhours` / `billbalance` / `billfinalizedat` in one guarded operation:
 *   1. claim — `update tblbills … where billid = $1 and billfinalizedat is null and billtype/billnotice = <loaded>`; 0 rows → stale;
 *      the claim errors (its reply may be lost after it committed) → release, guarded on our stamp (a no-op if it never landed);
 *   2. insert the lines 1..n (one INSERT: all or nothing);
 *   3. insert failed → delete this bill's lines and release the claim (restore hours/balance), guarded on our stamp.
 * Only a bill `canFinalizeBill` allows is priced (not revised, not closed). A fingerprint of everything the page priced
 * from (activity ids + hours, funds, factors, dates, prefill, notice, revision) is posted back and recomputed; any
 * difference → stale. The admin's typed edits are not in it.
 */
import { createHash } from "node:crypto";
import type { Db } from "@/lib/time/entries";
import { thousandths } from "@/lib/time/week";
import { toCents } from "@/lib/expenses/list";
import { canFinalizeBill } from "./rules";
import { BillInputError } from "./edit";
import type { NoticeDeps } from "./notice";
import { BillLineError, billHours, creditsForBill, priceBill, summarize, type BillLine, type LineKind, type PricingInput, type PricingWarning } from "./lines";
import { FinalizeInputError, centsText, finalLines, toModel, type EstimateModel, type FinalizeBase } from "./finalize-model";

export type FinalizeBill = {
  billid: number;
  billcaseid: number;
  billdate: string;
  billtype: string | null;
  billhours: number | string;
  billbalance: number | string;
  billfinalizedat: string | null;
  supersedesbillid: number | null;
  billnotice: string;
};
export type FinalizeData = {
  bill: FinalizeBill;
  casetitle: string | null;
  billingalert: boolean;
  billingcc: string | null;
  initials: Record<number, string>;
  /** This bill's saved lines (a finalized bill renders these, never a re-pricing). */
  stored: BillLine[];
  /** null → nothing to finalize: legacy (billtype null), already finalized, revised, or closed (see canFinalizeBill). */
  base: FinalizeBase | null;
  /** Another bill supersedes this one. */
  revised: boolean;
  /** Finalized, but the stored lines don't add up to billbalance/billhours (see brokenFinalize). */
  broken: boolean;
  /** Timesheet revision: the superseded bill's STORED rate per person ([personid, cents]). */
  prior: [number | null, number][];
  warnings: PricingWarning[];
  /** A timesheet with no time rows. */
  empty: boolean;
  fingerprint: string;
};

/** Every row of a query, 1000 per request; `build` applies its own order. (lib/cases/presets.ts has the same loop, unexported.) */
async function all<T>(build: () => any, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(`${what} read: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}

type LineRow = { lineno: number; kind: string; linedate: string | null; description: string; personid: number | null; hours: number | string | null; rate: number | string | null; amount: number | string };
const LINE_COLS = "lineno, kind, linedate, description, personid, hours, rate, amount";
const fromRow = (r: LineRow): BillLine => ({
  kind: r.kind as LineKind, linedate: r.linedate, description: r.description, personid: r.personid,
  hours: r.hours === null ? null : thousandths(r.hours), rate: r.rate === null ? null : toCents(r.rate), amount: toCents(r.amount),
});
/** A bill's saved lines in lineno order. */
export const storedLines = (db: Db, billid: number): Promise<BillLine[]> =>
  all<LineRow>(() => db.from("tblbilllines").select(LINE_COLS).eq("billid", billid).order("lineno", { ascending: true }), "tblbilllines")
    .then((rows) => rows.map(fromRow));

/** Several bills' saved lines in one paged read: billid → lines in lineno order (a bill with none maps to []). */
export async function storedLinesFor(db: Db, billids: number[]): Promise<Map<number, BillLine[]>> {
  const out = new Map<number, BillLine[]>(billids.map((id) => [id, []]));
  if (!billids.length) return out;
  // ponytail: one .in() with every id — fine for a case or the open-bill list; chunk it if it nears URL limits.
  const rows = await all<LineRow & { billid: number }>(() => db.from("tblbilllines").select(`billid, ${LINE_COLS}`)
    .in("billid", billids).order("billid", { ascending: true }).order("lineno", { ascending: true }), "tblbilllines");
  for (const r of rows) out.get(r.billid)?.push(fromRow(r));
  return out;
}

/** Integer thousandths → exact numeric(9,3) text ("-2.500"), no float. (Money goes through centsText.) */
const thousandthsText = (n: number): string => {
  const a = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.trunc(a / 1000)}.${String(a % 1000).padStart(3, "0")}`;
};

/**
 * A finalized typed bill whose stored lines don't add up to its billbalance / billhours: its lines were lost (a claim
 * that committed with no lines). Items 4 and 5 refuse such a bill; Revise rebuilds it. A legitimate 0-line $0 bill
 * stores 0 / 0, so it is never flagged.
 */
export function brokenFinalize(
  bill: { billtype: string | null; billfinalizedat: string | null; billhours: number | string; billbalance: number | string },
  stored: BillLine[],
): boolean {
  if (bill.billtype === null || !bill.billfinalizedat) return false;
  const sum = summarize(stored);
  return sum.balance !== toCents(bill.billbalance) || billHours(sum.hours) !== thousandths(bill.billhours);
}

export async function loadFinalize(db: Db, billid: number): Promise<FinalizeData | null> {
  const b = await db.from("tblbills")
    .select("billid, billcaseid, billdate, billtype, billhours, billbalance, billfinalizedat, supersedesbillid, billnotice")
    .eq("billid", billid).maybeSingle();
  if (b.error) throw new Error(`tblbills read: ${b.error.message}`);
  if (!b.data) return null;
  const bill = b.data as FinalizeBill;
  const rev = await db.from("tblbills").select("billid").eq("supersedesbillid", billid).limit(1);
  if (rev.error) throw new Error(`tblbills read: ${rev.error.message}`);
  const revised = (rev.data ?? []).length > 0;
  const open = canFinalizeBill(bill, revised);
  const [kase, stored, names, acts, funds, prev, prevLines] = await Promise.all([
    db.from("tblcase").select("casetitle, casestartdate, billingalert, billingcc").eq("caseid", bill.billcaseid).maybeSingle(),
    storedLines(db, billid),
    all<{ personid: number; initials: string; billingfactor: number | string }>(
      () => db.from("tblbillingnames").select("personid, initials, billingfactor").order("personid", { ascending: true }), "tblbillingnames"),
    open ? all<{ actid: number; actdate: string; actdescription: string; acthrs: number | string; actwho: number | null }>(
      () => db.from("tblactivity").select("actid, actdate, actdescription, acthrs, actwho").eq("actbillid", billid)
        .order("actdate", { ascending: true }).order("actid", { ascending: true }), "tblactivity") : [],
    open ? all<{ fndsid: number; fndsdate: string; fndstype: string | null; fndspmt: number | string; fndsbillid: number | null }>(
      () => db.from("tblfundsrcvd").select("fndsid, fndsdate, fndstype, fndspmt, fndsbillid").eq("fndscaseid", bill.billcaseid)
        .order("fndsdate", { ascending: true }).order("fndsid", { ascending: true }), "tblfundsrcvd") : [],
    open && bill.supersedesbillid !== null
      ? db.from("tblbills").select("billtype").eq("billid", bill.supersedesbillid).maybeSingle() : null,
    open && bill.supersedesbillid !== null ? storedLines(db, bill.supersedesbillid) : [],
  ]);
  if (kase.error) throw new Error(`tblcase read: ${kase.error.message}`);
  if (prev?.error) throw new Error(`tblbills read: ${prev.error.message}`);
  const initials: Record<number, string> = {};
  for (const n of names) initials[n.personid] = n.initials;

  let base: FinalizeBase | null = null;
  let prior: [number | null, number][] = [];
  let warnings: PricingWarning[] = [];
  if (open) {
    const billType = bill.billtype!;
    const seen = new Set(acts.map((a) => a.actwho));
    const factors: Record<number, number> = {};
    for (const n of names) if (seen.has(n.personid)) factors[n.personid] = thousandths(n.billingfactor);
    const input: PricingInput = {
      billType,
      billDate: bill.billdate,
      caseStartDate: kase.data?.casestartdate ?? bill.billdate,
      activity: acts.map((a) => ({ date: a.actdate, description: a.actdescription ?? "", hours: thousandths(a.acthrs), personid: a.actwho, id: a.actid })),
      factors,
      funds: creditsForBill(funds.map((f) => ({ date: f.fndsdate, type: f.fndstype, amount: toCents(f.fndspmt), fndsbillid: f.fndsbillid, id: f.fndsid })), billid),
    };
    const priced = priceBill(input);
    warnings = priced.warnings ?? [];
    // A revision starts from what the superseded bill actually saved, not today's defaults.
    const sameType = prev?.data?.billtype === billType && prevLines.length > 0;
    const model: EstimateModel = billType !== "timesheet" && sameType ? toModel(prevLines) : toModel(priced.lines);
    if (billType === "timesheet" && sameType) {
      prior = prevLines.filter((l) => l.kind === "charge" && l.rate !== null).map((l) => [l.personid, l.rate!]);
    }
    base = { billType, input, model: billType === "timesheet" ? { groups: [], flats: [] } : model };
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ base, prior, lines: base ? priceBill(base.input).lines : [], stored: stored.length, fin: bill.billfinalizedat, notice: bill.billnotice, revised }))
    .digest("hex");
  return {
    bill,
    casetitle: kase.data?.casetitle ?? null,
    billingalert: kase.data?.billingalert === true,
    billingcc: kase.data?.billingcc ?? null,
    initials,
    stored,
    base,
    revised,
    broken: brokenFinalize(bill, stored),
    prior,
    warnings,
    empty: base?.billType === "timesheet" && base.input.activity.length === 0,
    fingerprint,
  };
}

/** Claim, insert, undo on failure (see header). `now` stamps billfinalizedat. */
export async function finalizeBill(db: Db, data: FinalizeData, lines: BillLine[], now: Date): Promise<void> {
  const { bill } = data;
  const sum = summarize(lines);
  const stamp = now.toISOString();
  // Undo our claim only: guarded on our own stamp, so it changes nothing when the claim never landed.
  const release = () => db.from("tblbills")
    .update({ billfinalizedat: null, billhours: bill.billhours, billbalance: bill.billbalance })
    .eq("billid", bill.billid).eq("billfinalizedat", stamp).select("billid");
  const claim = await db.from("tblbills")
    .update({ billfinalizedat: stamp, billhours: centsText(billHours(sum.hours) / 10), billbalance: centsText(sum.balance) })
    .eq("billid", bill.billid).is("billfinalizedat", null).eq("billtype", data.base!.billType).eq("billnotice", bill.billnotice)
    .select("billid");
  if (claim.error) {
    // The reply can be lost after the claim committed: never leave the bill "finalized with no lines".
    const rel = await release();
    if (rel.error) console.error("finalizeBill release after claim error failed:", bill.billid, rel.error);
    throw new Error(`tblbills finalize: ${claim.error.message}`);
  }
  if ((claim.data ?? []).length !== 1) throw new BillInputError("stale");
  if (!lines.length) return;

  const ins = await db.from("tblbilllines").insert(lines.map((l, i) => ({
    billid: bill.billid,
    lineno: i + 1,
    kind: l.kind,
    linedate: l.linedate,
    description: l.description,
    personid: l.personid,
    hours: l.hours === null ? null : thousandthsText(l.hours),
    rate: l.rate === null ? null : centsText(l.rate),
    amount: centsText(l.amount),
  }))).select("lineid");
  if (!ins.error && (ins.data ?? []).length === lines.length) return;

  // ponytail: compensation over PostgREST, not a transaction (as revise.ts) — if the undo itself fails the bill stays
  // finalized with partial/no lines and is logged for manual cleanup. The bill had no lines before (runFinalize checks)
  // and our claim blocks any other finalize, so every line on it now is ours.
  const del = await db.from("tblbilllines").delete().eq("billid", bill.billid).select("lineid");
  const rel = await release();
  if (del.error || rel.error || (rel.data ?? []).length !== 1) console.error("finalizeBill compensation failed:", bill.billid, del.error, rel.error);
  throw new Error(`tblbilllines insert: ${ins.error?.message ?? "row count mismatch"}`);
}

/**
 * Body of the finalizeBill server action. Admin check first (staff → forbidden, no DB call); redirects outside try.
 * `afterFinalize` (the invoice PDF) runs only after a successful save; whatever it throws is logged, never surfaced.
 * Success → /bills/<id>?saved=1; refusal → /bills/<id>/finalize?error=<code>.
 */
export async function runFinalize(
  billid: number, formData: FormData,
  deps: NoticeDeps & { afterFinalize?: (db: Db, billid: number) => Promise<unknown> },
): Promise<void> {
  let code: string | null = null;
  try {
    await deps.session();
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else throw e;
  }
  if (!code && (!Number.isSafeInteger(billid) || billid <= 0)) code = "notfound";
  if (!code) {
    const get = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
    try {
      const db = deps.db();
      const data = await loadFinalize(db, billid);
      if (!data) throw new BillInputError("notfound");
      if (data.bill.billtype === null) throw new BillInputError("legacy");
      if (!data.bill.billfinalizedat && !data.base) throw new BillInputError("revised");
      if (!data.base || data.stored.length) throw new BillInputError("stale");
      if (get("fingerprint") !== data.fingerprint) throw new BillInputError("stale");
      const lines = finalLines(data.base, get);
      await finalizeBill(db, data, lines, deps.now());
      // The invoice PDF (item 4) is made after the bill is finalized; its failure never un-finalizes the bill —
      // the bill page then offers "Create PDF".
      if (deps.afterFinalize) await deps.afterFinalize(db, billid).catch((e) => console.error("invoice PDF after finalize:", billid, e));
    } catch (e) {
      if (e instanceof BillInputError || e instanceof FinalizeInputError) code = e.code;
      else if (e instanceof BillLineError) code = e.field;
      else if (e instanceof RangeError) code = "range";
      else {
        console.error("finalizeBill:", e);
        code = "failed";
      }
    }
  }
  deps.revalidatePath(`/bills/${billid}`);
  deps.redirect(code ? `/bills/${billid}/finalize?error=${code}` : `/bills/${billid}?saved=1`);
}
