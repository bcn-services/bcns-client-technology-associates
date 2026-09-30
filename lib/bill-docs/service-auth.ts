/**
 * Service authorization document (billing-output item 7) — legacy `CreateServAuth` + `AddWorkPerformed`: the
 * <branch>ServAuth.dotx work-estimate form drawn with pdf-lib and filled from the case. Bookmarks: Sub (caption /
 * title / #caseid), Atty ("First Last, Esq. / phone"), Firm, DateBox (short date), Rate (the item-2 default standard
 * rate for today), and the Date / Services performed / Hrs table of the case's UNBILLED work (actbilled = false and
 * actbillid is null — loadNewBill's rows, the same rows Create Bill offers). Everything else on the form is left blank
 * for the firm to fill by hand, as the template does.
 *
 * Create SA: render → store under a key nothing else holds (upload refuses to overwrite) → insert the tblsrvauth row.
 * If the insert fails, the row is looked up before compensating: found → success; cleanly absent → the object is
 * removed; lookup failed → the object is kept (an orphan file is harmless; a row pointing at a missing file is not).
 */
import type { PDFPage } from "pdf-lib";
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { createServerClient, DbNotConfiguredError } from "@/lib/db/client";
import { STORAGE_BUCKET } from "@/lib/storage";
import { firstFreeName, loadNewBill } from "@/lib/bills/create";
import { defaultRates } from "@/lib/bills/rates";
import { fmtHours, thousandths } from "@/lib/time/week";
import { NEW_SA_STATUS, saContact, saFileBase, saKey, saSubject, shortDate } from "@/lib/cases/service-auths";
import { INK, W, H, L, R, wrap, openDoc, drawLetterhead, mdyy, dollars, fixed2, type TextFn } from "./pdf";
import type { InvoiceConfig } from "./invoice";

export type SaDocRow = { date: string; text: string; hrs: number };
export type SaDoc = {
  caseid: number; today: string; subject: string; contact: string; firm: string; attyLast: string;
  rateCents: number; rows: SaDocRow[]; hoursMilli: number;
};

/** What the SA prints, or null when the case doesn't exist. `now` → the firm's today. */
export async function loadSaDoc(db: Db, caseId: number, now: Date): Promise<SaDoc | null> {
  const [nb, k] = await Promise.all([
    loadNewBill(db, caseId, now),
    db.from("tblcase").select("casetitle, casecaption, casestartdate, caseatty").eq("caseid", caseId).maybeSingle(),
  ]);
  if (k.error) throw new Error(`tblcase read: ${k.error.message}`);
  if (!nb || !k.data) return null;
  const a = k.data.caseatty == null ? null
    : await db.from("tblattorney").select("attyfirstname, attylastname, attyfirmid").eq("attyid", k.data.caseatty).maybeSingle();
  if (a?.error) throw new Error(`tblattorney read: ${a.error.message}`);
  const f = a?.data?.attyfirmid == null ? null
    : await db.from("tblfirm").select("frmname, frmphone").eq("frmid", a.data.attyfirmid).maybeSingle();
  if (f?.error) throw new Error(`tblfirm read: ${f.error.message}`);
  // loadNewBill lists newest first; the SA reads oldest first like the timesheet.
  const rows = [...nb.rows].reverse().map((r) => ({ date: r.actdate, text: r.actdescription ?? "", hrs: thousandths(r.acthrs) }));
  return {
    caseid: caseId,
    today: nb.today,
    subject: saSubject(k.data.casecaption, k.data.casetitle, caseId),
    contact: saContact(a?.data?.attyfirstname, a?.data?.attylastname, f?.data?.frmphone),
    firm: String(f?.data?.frmname ?? "").trim(),
    attyLast: String(a?.data?.attylastname ?? "").trim(),
    rateCents: defaultRates(nb.today, k.data.casestartdate ?? nb.today).standard,
    rows,
    hoursMilli: rows.reduce((t, r) => t + r.hrs, 0),
  };
}

const TITLE = "Forensic Engineering Consulting Work Estimate and Authorization";
const rateText = (rate: string) =>
  `The completed and estimated services listed below are performed by one of our experts at a rate of $${rate}/hr plus expenses. `
  + "You will be notified in writing of significant departures from this estimate (i.e. over 20%) should they be required. "
  + "A fee schedule is available upon request.";
const ESTIMATES = [
  "Prior advance received: $",
  "Estimated expenses: $",
  "Estimated additional charges for above work (including expenses): $",
  "Additional advance required to guarantee start and timely completion of work: $",
];
const WORKLOAD = "Please note that given our current workload, we estimate it will require ______ business days to complete the "
  + "estimated work after we receive the signed work estimate and any required advance.";
const RETURN = "Please make a copy for your files, and return the signed estimate with the required advance.";
const TERMS = "Terms: This estimate is valid for 60 days from the date prepared. The final invoice is payable net 30 days and "
  + "before any testimony is given. Reports will not be sent until final invoice payment is received. Clients are "
  + "responsible for all legal charges associated with collection.";
const BLANK = "______________";
const SIZE = 11, LEAD = 15, BOTTOM = 60;
const DESC = L + 62, HRS_R = R;

/** Draw the SA. Pure: no DB, no clock, no env. */
export async function renderServiceAuth(d: SaDoc, cfg: InvoiceConfig): Promise<Uint8Array> {
  const { doc, reg, bold, clean } = await openDoc(`Service authorization ${d.caseid}`);
  let page: PDFPage = doc.addPage([W, H]);
  const text: TextFn = (s, x, y, size = SIZE, font = reg) => { if (s) page.drawText(clean(s), { x, y, size, font, color: INK }); };
  const width = (s: string, size = SIZE, font = reg) => font.widthOfTextAtSize(clean(s), size);
  const right = (s: string, xr: number, y: number, size = SIZE, font = reg) => text(s, xr - width(s, size, font), y, size, font);
  const rule = (x1: number, x2: number, y: number) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color: INK });
  const para = (s: string, x = L, size = SIZE, lead = LEAD) => { for (const part of wrap(reg, size, clean(s), R - x)) { room(lead); text(part, x, y, size); y -= lead; } };
  const newPage = () => { page = doc.addPage([W, H]); y = H - 72; };
  const room = (h: number) => { if (y - h < BOTTOM) newPage(); };

  let y = drawLetterhead(cfg.letterhead, text, bold);
  text(TITLE, L, y, 12, bold);
  if (cfg.taxId) right(`Tax ID # ${cfg.taxId}`, R, y);
  y -= 30;

  // Filled bookmarks, each on underlined lines after its label (the template's blanks).
  const filled = (label: string, value: string, x: number) => {
    text(label, L, y);
    for (const part of wrap(reg, SIZE, clean(value), R - x)) { text(part, x, y); rule(x, R, y - 3); y -= LEAD + 3; }
  };
  filled("Caption/Subject/Our Case #:", d.subject, L + width("Caption/Subject/Our Case #:") + 6);
  filled("Contact/Phone:", d.contact, L + width("Contact/Phone:") + 6);
  filled("", d.firm, L + 80);
  y -= 6;
  para(rateText(dollars(d.rateCents)));
  y -= 12;

  // Services already performed since last invoice: one row per unbilled time entry.
  const header = (a: string, b: string, c: string) => {
    room(3 * LEAD);
    text(a, L, y, 10, bold); text(b, DESC + 60, y, 10, bold); right(c, HRS_R, y, 10, bold);
    rule(L, R, y - 4);
    y -= LEAD + 4;
  };
  header("Date", "Services already performed since last invoice", "Time (hrs)");
  const hrsW = width("000.00") + 12;
  for (const r of d.rows) {
    const parts = wrap(reg, SIZE, clean(r.text), HRS_R - hrsW - DESC);
    if (y - parts.length * LEAD < BOTTOM) { newPage(); header("Date", "Services already performed since last invoice", "Time (hrs)"); }
    text(mdyy(r.date), L, y);
    right(fixed2(r.hrs), HRS_R, y);
    for (const part of parts) { text(part, DESC, y); y -= LEAD; }
  }
  if (d.rows.length === 0) y -= 2 * LEAD;
  y -= LEAD;

  header("", "Services to be performed", "Time Est. (hrs)");
  for (let i = 0; i < 5; i++) { room(LEAD + 4); y -= LEAD + 4; rule(L, R, y + 2); }
  y -= LEAD;

  for (const s of ESTIMATES) { room(LEAD); text(`${s}${BLANK}`, L, y); y -= LEAD; }
  y -= 6;
  para(WORKLOAD);
  y -= 16;
  room(3 * 24 + 8 * 11);
  text(`Estimate reviewed by: ${"_".repeat(36)}  Date: `, L, y);
  text(shortDate(d.today), L + width(`Estimate reviewed by: ${"_".repeat(36)}  Date: `), y);
  y -= 24;
  text(`Signature of Contact: ${"_".repeat(36)}  Date: ${BLANK}`, L, y);
  y -= 24;
  text(`Print Contact's Name: ${"_".repeat(52)}`, L, y);
  y -= 20;
  text(RETURN, L, y, 10, bold);
  y -= 14;
  para(TERMS, L, 9, 11);
  return doc.save();
}

/** The SA storage seam: `create` writes a NEW object (false when the key is already taken — never overwrites). */
export type SaStore = { create: (key: string, bytes: Uint8Array) => Promise<boolean>; remove: (key: string) => Promise<void> };

/** The app's store (Supabase Storage, private bucket), or null when storage is unconfigured. */
export function saStore(): SaStore | null {
  let bucket: ReturnType<ReturnType<typeof createServerClient>["storage"]["from"]>;
  try {
    bucket = createServerClient().storage.from(STORAGE_BUCKET);
  } catch (e) {
    if (e instanceof DbNotConfiguredError) return null;
    throw e;
  }
  return {
    async create(key, bytes) {
      const { error } = await bucket.upload(key, bytes, { contentType: "application/pdf", upsert: false });
      if (!error) return true;
      const e = error as { statusCode?: string; status?: number; message?: string };
      if (e.statusCode === "409" || e.status === 409 || /already exists|duplicate/i.test(e.message ?? "")) return false;
      throw new Error(`storage upload ${key}: ${e.message ?? String(error)}`);
    },
    async remove(key) {
      const { error } = await bucket.remove([key]);
      if (error) throw new Error(`storage remove ${key}: ${error.message}`);
    },
  };
}

export class SaCreateError extends Error {
  constructor(readonly code: "notfound" | "create-storage" | "create-failed" | "create-unknown") {
    super(code);
    this.name = "SaCreateError";
  }
}

/** How many taken `-N` names Create SA steps past before giving up. */
const MAX_TRIES = 50;

/**
 * Render the case's SA, store it as `<saKey>` under the first `-N` that neither a tblsrvauth row on the case (any case
 * of letters) nor an existing object holds, then insert the "Awaiting Approval" row: today, requested hours = the
 * unbilled rows' hours, srvauthfile = the name. See the file header for what happens when the insert fails.
 */
export async function createServiceAuth(db: Db, store: SaStore | null, caseId: number, now: Date, cfg: InvoiceConfig): Promise<{ srvauthid: number; srvauthfile: string }> {
  if (!store) throw new SaCreateError("create-storage");
  const d = await loadSaDoc(db, caseId, now);
  if (!d) throw new SaCreateError("notfound");
  const bytes = await renderServiceAuth(d, cfg);
  const r = await db.from("tblsrvauth").select("srvauthfile").eq("srvauthcaseid", caseId);
  if (r.error) throw new Error(`tblsrvauth read: ${r.error.message}`);
  const used = new Set(((r.data ?? []) as { srvauthfile: string | null }[]).map((x) => String(x.srvauthfile ?? "").toLowerCase()));
  const base = saFileBase(caseId, d.attyLast, d.today);
  let name = "";
  for (let i = 0; ; i++) {
    if (i >= MAX_TRIES) throw new Error(`no free SA name for ${base}`);
    name = firstFreeName(base, (n) => used.has(n.toLowerCase()));
    if (await store.create(saKey(caseId, name), bytes)) break;
    used.add(name.toLowerCase());
  }
  const key = saKey(caseId, name);
  const row = { srvauthcaseid: caseId, srvauthdate: d.today, srvauthhours: fmtHours(d.hoursMilli), srvauthstatus: NEW_SA_STATUS, srvauthfile: name };
  const ins = await db.from("tblsrvauth").insert(row).select("srvauthid").single().then((x: { data: { srvauthid: number } | null; error: unknown }) => x, (e: unknown) => ({ data: null, error: e }));
  if (!ins.error && ins.data) return { srvauthid: ins.data.srvauthid, srvauthfile: name };
  // An insert that answered with an error may still have committed: look before compensating.
  const chk = await db.from("tblsrvauth").select("srvauthid").eq("srvauthcaseid", caseId).eq("srvauthfile", name)
    .then((x: { data: { srvauthid: number }[] | null; error: unknown }) => x, (e: unknown) => ({ data: null, error: e }));
  if (chk.error || !chk.data) {
    console.error("createServiceAuth: insert failed and the check failed; keeping", key, ins.error, chk.error);
    throw new SaCreateError("create-unknown");
  }
  if (chk.data.length) return { srvauthid: chk.data[0]!.srvauthid, srvauthfile: name };
  try { await store.remove(key); } catch (e) { console.error("createServiceAuth: orphan object left at", key, e); }
  console.error("createServiceAuth: insert failed:", ins.error);
  throw new SaCreateError("create-failed");
}

export type CreateSaDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  store: () => SaStore | null;
  config: () => InvoiceConfig;
  now: () => Date;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => never;
};

/** Body of the Create SA server action — any signed-in user. Back to the case's SA panel with ?sa_new=<id> or ?sa_error=<code>. */
export async function runCreateSa(caseId: number, deps: CreateSaDeps): Promise<void> {
  await deps.session(); // no session → the login redirect propagates
  let q: string;
  if (!Number.isSafeInteger(caseId) || caseId <= 0) q = "sa_error=notfound";
  else {
    try {
      q = `sa_new=${(await createServiceAuth(deps.db(), deps.store(), caseId, deps.now(), deps.config())).srvauthid}`;
    } catch (e) {
      if (e instanceof SaCreateError) q = `sa_error=${e.code}`;
      else {
        console.error("createServiceAuth:", caseId, e);
        q = "sa_error=create-failed";
      }
    }
    deps.revalidatePath(`/cases/${caseId}`);
    deps.revalidatePath("/cases/service-auths");
  }
  deps.redirect(`/cases/${caseId}?${q}&t=${deps.now().getTime()}#service-auths`);
}

/** Storage key of SA `srvauthid`'s PDF, or null when there is no such row or it names no file. */
export async function saPdfKey(db: Db, srvauthid: number): Promise<string | null> {
  const { data, error } = await db.from("tblsrvauth").select("srvauthcaseid, srvauthfile").eq("srvauthid", srvauthid).maybeSingle();
  if (error) throw new Error(`tblsrvauth read: ${error.message}`);
  return data?.srvauthfile ? saKey(Number(data.srvauthcaseid), String(data.srvauthfile)) : null;
}
