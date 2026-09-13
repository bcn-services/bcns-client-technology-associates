/** Bill page: load one bill with its case, attached time and revisions; admin edit-in-place of six columns. */
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { BILL_TYPES } from "./rules";

export type BillRow = {
  billid: number;
  billcaseid: number;
  billdate: string;
  billhours: number | string;
  billbalance: number | string;
  billreports: number | null;
  billfilename: string | null;
  billnotice: string;
  billpaiddate: string | null;
  billestimate: boolean | null;
  billpriority: number | null;
  billcomments: string | null;
  billsecondnoticedate: string | null;
  billfinalnoticedate: string | null;
  billtype: string | null;
  supersedesbillid: number | null;
};
export type BillActivity = { actid: number; actdate: string; actdescription: string; acthrs: number | string; initials: string };
export type BillPageData = {
  bill: BillRow;
  casetitle: string | null;
  activity: BillActivity[];
  revisedBy: number[];
};

export class BillInputError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "BillInputError";
  }
}

const MESSAGES: Record<string, string> = {
  date: "Bill date must be a valid date.",
  type: "Pick a bill type from the list.",
  balance: "Balance must be an amount like 875.00 (negative allowed).",
  notfound: "That bill no longer exists.",
  forbidden: "Only admins can edit bills.",
  failed: "The bill could not be saved.",
  notice: "Pick a start status: 1st, Credit or Refund.",
  case: "That case does not exist.",
  stale: "Some entries were billed meanwhile — reload and try again",
};
/** Money typed as text: up to 10 digits, 2 decimals, negative allowed (commas stripped first). */
export const BALANCE_RE = /^-?\d{1,10}(\.\d{1,2})?$/;
export const billErrorMessage = (code: string): string => MESSAGES[code] ?? MESSAGES.failed!;

/** Money as 2-decimal text. numeric(12,2) fits a double exactly enough for display; no arithmetic is done on it. */
export const fmtMoney = (v: number | string): string => Number(v).toFixed(2);

/** The ONLY columns the edit may write. Everything else (notice, notice/paid dates, hours, case, activity) is out of reach. */
export const EDITABLE = ["billdate", "billtype", "billbalance", "billestimate", "billcomments", "billfilename"] as const;
export type BillEdit = { [K in (typeof EDITABLE)[number]]: K extends "billestimate" ? boolean : string | null };

const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Parse the edit form. Balance goes to PostgREST as text so numeric(12,2) receives it unrounded by float. */
export function parseBillEdit(get: (k: string) => string): BillEdit {
  const billdate = get("billdate").trim();
  if (!isDate(billdate)) throw new BillInputError("date");
  const type = get("billtype").trim();
  if (type && !BILL_TYPES.includes(type)) throw new BillInputError("type");
  const balance = get("billbalance").trim().replace(/,/g, "");
  if (!BALANCE_RE.test(balance)) throw new BillInputError("balance");
  const opt = (k: string) => get(k).trim() || null;
  return {
    billdate,
    billtype: type || null,
    billbalance: balance,
    billestimate: get("billestimate") === "on",
    billcomments: opt("billcomments"),
    billfilename: opt("billfilename"),
  };
}

/** Writes exactly the EDITABLE keys of `input` to bill `billid`; one row must match. */
export async function updateBill(db: Db, billid: number, input: BillEdit): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const k of EDITABLE) payload[k] = input[k];
  const { data, error } = await db.from("tblbills").update(payload).eq("billid", billid).select("billid");
  if (error) throw new Error(`tblbills update: ${error.message}`);
  if (!data || data.length !== 1) throw new BillInputError("notfound");
}

export async function loadBill(db: Db, billid: number): Promise<BillPageData | null> {
  const b = await db.from("tblbills").select("*").eq("billid", billid).maybeSingle();
  if (b.error) throw new Error(`tblbills read: ${b.error.message}`);
  if (!b.data) return null;
  const bill = b.data as BillRow;
  const [kase, act, names, rev] = await Promise.all([
    db.from("tblcase").select("caseid, casetitle").eq("caseid", bill.billcaseid).maybeSingle(),
    db.from("tblactivity")
      .select("actid, actdate, actdescription, acthrs, actwho")
      .eq("actbillid", billid)
      .order("actdate", { ascending: true })
      .order("actid", { ascending: true }),
    db.from("tblbillingnames").select("personid, initials"),
    db.from("tblbills").select("billid").eq("supersedesbillid", billid).order("billid", { ascending: true }),
  ]);
  for (const [r, what] of [[kase, "tblcase"], [act, "tblactivity"], [names, "tblbillingnames"], [rev, "tblbills revisions"]] as const) {
    if (r.error) throw new Error(`${what} read: ${r.error.message}`);
  }
  const initials = new Map<number, string>((names.data ?? []).map((n: { personid: number; initials: string }) => [n.personid, n.initials]));
  return {
    bill,
    casetitle: kase.data?.casetitle ?? null,
    activity: (act.data ?? []).map((r: BillActivity & { actwho: number | null }) => ({
      actid: r.actid,
      actdate: r.actdate,
      actdescription: r.actdescription,
      acthrs: r.acthrs,
      initials: (r.actwho != null && initials.get(r.actwho)) || "",
    })),
    revisedBy: (rev.data ?? []).map((r: { billid: number }) => r.billid),
  };
}

export type EditDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => never;
};

/**
 * Body of the `editBill` server action (app/bills/actions.ts passes the real deps).
 * Admin check first; a staff POST gets ?error=forbidden and no DB call. Redirects stay outside try.
 * ponytail: last write wins on concurrent admin edits (no orig-value guard) — add a guard if two admins edit one bill at once.
 */
export async function runEditBill(billid: number, formData: FormData, deps: EditDeps): Promise<void> {
  let code: string | null = null;
  try {
    await deps.session();
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else throw e; // no-session redirect propagates
  }
  if (!code && (!Number.isSafeInteger(billid) || billid <= 0)) code = "notfound";
  if (!code) {
    const get = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
    try {
      await updateBill(deps.db(), billid, parseBillEdit(get));
    } catch (e) {
      if (e instanceof BillInputError) code = e.code;
      else {
        console.error("editBill:", e);
        code = "failed";
      }
    }
  }
  deps.revalidatePath(`/bills/${billid}`);
  // ponytail: a refused edit doesn't re-fill the typed values — echo them via query params if Kris hits this often
  deps.redirect(code ? `/bills/${billid}?error=${code}` : `/bills/${billid}?saved=1`);
}
