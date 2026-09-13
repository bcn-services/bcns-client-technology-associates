/**
 * Notice actions on one bill: Advance (1st → 2nd → Final, stamping that notice's date) and Close as
 * (Cancelled / Carried Over / Deadbeat / Settled). Every write filters on the notice the page rendered
 * (and, for Advance, on the target date column still being null), so a stale or duplicate submit updates
 * 0 rows and returns ?error=stale. Never writes billpaiddate, 'Paid' or 'Partial Payment'.
 */
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { firmToday } from "@/lib/cases/presets";
import { CLOSE_AS_NOTICES, isOpen, nextNotice } from "./rules";
import { BillInputError, billErrorMessage } from "./edit";

const DATE_COL: Readonly<Record<string, "billsecondnoticedate" | "billfinalnoticedate">> = {
  "2nd": "billsecondnoticedate",
  Final: "billfinalnoticedate",
};

const NOTICE_MESSAGES: Record<string, string> = {
  stale: "This bill changed meanwhile — reload and try again",
  move: "That status change is not allowed for this bill.",
};
/** Bill page messages: notice codes first, then the shared bill codes. */
export const noticeErrorMessage = (code: string): string => NOTICE_MESSAGES[code] ?? billErrorMessage(code);

/** Close-as targets offered for a bill in `notice`: none unless open; never the notice it already has (Deadbeat → Deadbeat is refused). */
export const closeTargets = (notice: string): string[] =>
  isOpen(notice) ? [...CLOSE_AS_NOTICES].filter((t) => t !== notice) : [];

async function guardedUpdate(db: Db, billid: number, expected: string, payload: Record<string, string>, nullCol?: string) {
  let q = db.from("tblbills").update(payload).eq("billid", billid).eq("billnotice", expected);
  if (nullCol) q = q.is(nullCol, null);
  const { data, error } = await q.select("billid");
  if (error) throw new Error(`tblbills notice update: ${error.message}`);
  if (!data || data.length !== 1) throw new BillInputError("stale");
}

/** `expected` = the notice the page rendered. Stamps the new notice's date with `today`; never overwrites a stamped date. */
export async function advanceNotice(db: Db, billid: number, expected: string, today: string): Promise<void> {
  const next = isOpen(expected) ? nextNotice(expected) : null;
  const col = next ? DATE_COL[next] : undefined;
  if (!next || !col) throw new BillInputError("move");
  await guardedUpdate(db, billid, expected, { billnotice: next, [col]: today }, col);
}

/** Only billnotice is written — both notice dates stay as they are. */
export async function closeBill(db: Db, billid: number, expected: string, target: string): Promise<void> {
  if (!closeTargets(expected).includes(target)) throw new BillInputError("move");
  await guardedUpdate(db, billid, expected, { billnotice: target });
}

export type NoticeDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  now: () => Date;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => never;
};

/** Body of the advanceNotice / closeBill server actions. Admin check first (staff → forbidden, no DB call); redirects outside try. */
export async function runNoticeAction(kind: "advance" | "close", billid: number, formData: FormData, deps: NoticeDeps): Promise<void> {
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
      if (kind === "advance") await advanceNotice(deps.db(), billid, get("expected"), firmToday(deps.now()));
      else await closeBill(deps.db(), billid, get("expected"), get("target"));
    } catch (e) {
      if (e instanceof BillInputError) code = e.code;
      else {
        console.error(`${kind}Notice:`, e);
        code = "failed";
      }
    }
  }
  deps.revalidatePath(`/bills/${billid}`);
  deps.redirect(code ? `/bills/${billid}?error=${code}` : `/bills/${billid}?saved=1`);
}
