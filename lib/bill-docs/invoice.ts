/**
 * Invoice PDF (billing-output item 4) — the legacy `MakeBillWordDoc` layout drawn with pdf-lib from a FINALIZED
 * bill's STORED lines (`tblbilllines`). Never re-prices: every figure printed is a stored line's description/amount
 * or the bill's stored `billbalance`; nothing here imports rates.ts or the pricing engine's price functions.
 *
 * Formats follow the VBA: activity and payment rows `M/D/YY`, the retainer row `mm/dd/yy`, estimate rows "TBD",
 * activity hours `Format(x, "fixed")` (2 decimals), money `#,###` (whole dollars), document date `mmmm dd, yyyy`.
 * Letterhead and TAX ID come from config (BILL_LETTERHEAD / BILL_TAX_ID); unset → that row is not drawn.
 */
import type { PDFFont, PDFPage } from "pdf-lib";
import type { StorageAdapter } from "@/lib/storage";
import { getConfig } from "@/lib/env";
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { toCents, fmtCents } from "@/lib/expenses/list";
import { INK, W, H, L, R, RCOL, wrap, openDoc, drawLetterhead, ymd, mdyy, dollars, fixed2 } from "./pdf";
import { labelLines, type LabelAttorney, type LabelFirm } from "@/lib/cases/search";
import { brokenFinalize, storedLines } from "@/lib/bills/finalize";
import { summarize, type BillLine } from "@/lib/bills/lines";
import { billFileName, keySafe } from "@/lib/bills/rules";
import { firstFreeName } from "@/lib/bills/create";

export type InvoiceConfig = { letterhead?: string[]; taxId?: string };
/** Letterhead + TAX ID from config (lazy env), shared by the invoice and the SA. */
export const docConfig = (): InvoiceConfig => { const c = getConfig(); return { letterhead: c.billLetterhead, taxId: c.billTaxId }; };
export type InvoiceBill = {
  billid: number; billcaseid: number; billdate: string; billtype: string | null; billhours: number | string;
  billbalance: number | string; billfinalizedat: string | null; billfilename: string | null; billpdfpath: string | null;
};
export type InvoiceData = { bill: InvoiceBill; casetitle: string; casecaption: string | null; address: string[]; attyLastName: string; lines: BillLine[] };

export class InvoiceError extends Error {
  constructor(readonly code: "notfound" | "legacy" | "unfinalized" | "broken" | "storage" | "stale") {
    super(code);
    this.name = "InvoiceError";
  }
}

/** Load what the PDF prints. Refuses a legacy, unfinalized, or broken (lines lost) bill. */
export async function loadInvoice(db: Db, billid: number): Promise<InvoiceData> {
  const b = await db.from("tblbills")
    .select("billid, billcaseid, billdate, billtype, billhours, billbalance, billfinalizedat, billfilename, billpdfpath")
    .eq("billid", billid).maybeSingle();
  if (b.error) throw new Error(`tblbills read: ${b.error.message}`);
  if (!b.data) throw new InvoiceError("notfound");
  const bill = b.data as InvoiceBill;
  if (bill.billtype === null) throw new InvoiceError("legacy");
  if (!bill.billfinalizedat) throw new InvoiceError("unfinalized");
  const [k, lines] = await Promise.all([
    db.from("tblcase").select("casetitle, casecaption, caseatty").eq("caseid", bill.billcaseid).maybeSingle(),
    storedLines(db, billid),
  ]);
  if (k.error) throw new Error(`tblcase read: ${k.error.message}`);
  if (brokenFinalize(bill, lines)) throw new InvoiceError("broken");
  const a = k.data ? await db.from("tblattorney")
    .select("attyfirmid, attytitle, attyfirstname, attymiddlename, attylastname, attysuffix, attyesq")
    .eq("attyid", k.data.caseatty).maybeSingle() : null;
  if (a?.error) throw new Error(`tblattorney read: ${a.error.message}`);
  const atty = (a?.data ?? null) as (LabelAttorney & { attyfirmid: number }) | null;
  const f = atty ? await db.from("tblfirm")
    .select("frmname, frmaddress1, frmaddress2, frmcity, frmstate, frmzip").eq("frmid", atty.attyfirmid).maybeSingle() : null;
  if (f?.error) throw new Error(`tblfirm read: ${f.error.message}`);
  return {
    bill,
    casetitle: k.data?.casetitle ?? "",
    casecaption: k.data?.casecaption ?? null,
    address: labelLines(atty, (f?.data ?? null) as LabelFirm | null),
    attyLastName: atty?.attylastname ?? "",
    lines,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** VBA `mm/dd/yy` (the retainer row). */
export const mmddyy = (d: string | null): string => { if (!d) return ""; const [y, m, day] = ymd(d); return [m, day, y % 100].map((n) => String(n).padStart(2, "0")).join("/"); };
/** VBA `mmmm dd, yyyy` — "September 07, 2026". */
export const longDate = (d: string): string => { const [y, m, day] = ymd(d); return `${MONTHS[m - 1]} ${String(day).padStart(2, "0")}, ${y}`; };
/** Balance due: whole dollars when whole, else dollars and cents — never hides a stored cent. */
const balanceText = (c: number): string => `${c < 0 ? "-" : ""}$${c % 100 === 0 ? dollars(Math.abs(c)) : fmtCents(Math.abs(c))}`;

type Row = { date?: string; ref?: string; hrs?: string; total?: string; charges?: string; credits?: string; gap?: boolean };
/** Stored lines → table rows, in stored order. Total rows ("<h> hrs x $r/hr") print their stored description + amount. */
export function invoiceRows(lines: BillLine[], estimated: boolean): Row[] {
  const est = estimated ? "(est.)" : "";
  const rows: Row[] = [];
  for (const l of lines) {
    if (l.kind === "credit") rows.push({ date: mdyy(l.linedate), ref: l.description, credits: dollars(l.amount) });
    else if (l.rate !== null) rows.push({ gap: true }, { total: l.description, charges: `${dollars(l.amount)}${l.kind === "estimate" ? "(est.)" : ""}` }, { gap: true });
    else if (l.kind === "estimate") rows.push({ date: "TBD", ref: l.description, hrs: `${(l.hours ?? 0) / 1000} hrs (est.)` });
    else if (l.kind === "expense") rows.push({ ref: l.description, charges: `$${dollars(l.amount)}${est ? ` ${est}` : ""}` });
    else if (l.hours !== null) rows.push({ date: mdyy(l.linedate), ref: l.description, hrs: `${fixed2(l.hours)} hrs` });
    else rows.push({ date: mmddyy(l.linedate), ref: l.description, charges: dollars(l.amount) });
  }
  // Collapse runs of gaps and drop leading/trailing ones.
  return rows.filter((r, i) => !r.gap || (i > 0 && i < rows.length - 1 && !rows[i + 1]!.gap));
}

const NOTE = [
  "Payment of estimated balance due must be",
  "received 7 days prior to date of scheduled testimony.",
  "",
  "A final bill and/or refund based upon actual charges",
  "will be issued after completion of testimony.",
];
const FOOTER = [
  "PLEASE NOTIFY US PROMPTLY IF THIS INVOICE DOES NOT AGREE WITH YOUR RECORDS",
  "PLEASE RETURN A COPY OF THIS INVOICE WITH YOUR CHECK",
];
// Letter page, points, measured off the legacy Word template. Text margin L; the table runs TL..TR with column rules
// between DATE | REFERENCE | CHARGES | CREDITS | BALANCE, from under its header down to TABLE_BOTTOM on every page.
const RX = 342;
const TL = 27, TR = 585, COLS = [TL, 94, 355, 437, 509, TR] as const;
const DATE_X = TL + 5, REF = COLS[1] + 5, HRS_R = COLS[2] - 9, CHG_R = COLS[3] - 5, CRD_R = COLS[4] - 5, BAL = COLS[4] + 4;
const TABLE_BOTTOM = 110, BOTTOM = 118;

/** Draw the invoice. Pure: no DB, no clock, no env. */
export async function renderInvoice(data: InvoiceData, cfg: InvoiceConfig): Promise<Uint8Array> {
  const { doc, reg, bold, clean } = await openDoc(`Invoice ${data.bill.billid}`);
  let page: PDFPage = doc.addPage([W, H]);
  const text = (s: string, x: number, y: number, size = 11, font = reg) => { if (s) page.drawText(clean(s), { x, y, size, font, color: INK }); };
  const right = (s: string, xr: number, y: number, size = 11, font = reg) => text(s, xr - font.widthOfTextAtSize(clean(s), size), y, size, font);
  const centerAt = (s: string, cx: number, y: number, size: number, font: PDFFont) => text(s, cx - font.widthOfTextAtSize(clean(s), size) / 2, y, size, font);
  const line = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.75, color: INK });

  // Letterhead as the legacy template: firm name at left, the rest (address, phone, web) in a column at right.
  let y = drawLetterhead(cfg.letterhead, text, bold);
  text("INVOICE", L, y, 18, bold);
  if (cfg.taxId) text(`TAX ID: ${cfg.taxId}`, RCOL, y, 11);
  y -= 48;

  // Attorney block (wrapped inside the window-envelope corner marks) beside DATE / RE / caption / Our File No.
  const top = y, BOX_R = 286;
  let left = y, rt = y;
  for (const s of data.address) for (const part of wrap(reg, 11, clean(s), BOX_R - 6 - L)) { text(part, L, left, 11); left -= 15; }
  const hasCaption = !!data.casecaption?.trim(), IND = 20;
  const block: [string, number][] = [
    [`DATE: ${longDate(data.bill.billdate)}`, 0], ["", 0], [`RE: ${data.casetitle}`, 0],
    ...(hasCaption ? [[data.casecaption!, IND] as [string, number]] : []),
    [`Our File No.: ${data.bill.billcaseid}`, hasCaption ? IND : 0],
  ];
  for (const [s, indent] of block) {
    wrap(reg, 11, clean(s), R - RX - IND).forEach((part, i) => { text(part, RX + (i ? IND : indent), rt, 11); rt -= 15; });
  }
  // Corner marks: four L-shaped ticks framing the address, as the envelope window on the Word template.
  const bx1 = L - 12, bx2 = BOX_R + 4, by1 = top + 18, by2 = Math.min(top - 78, left + 2), ax = 12, ay = 9;
  line(bx1, by1, bx1 + ax, by1); line(bx1, by1, bx1, by1 - ay);
  line(bx2, by1, bx2 - ax, by1); line(bx2, by1, bx2, by1 - ay);
  line(bx1, by2, bx1 + ax, by2); line(bx1, by2, bx1, by2 + ay);
  line(bx2, by2, bx2 - ax, by2); line(bx2, by2, bx2, by2 + ay);
  y = Math.min(by2, rt) - 30;

  let rulesTop = y;
  const header = () => {
    line(TL, y, TR, y);
    ["DATE", "REFERENCE", "CHARGES", "CREDITS", "BALANCE"].forEach((s, i) => centerAt(s, (COLS[i]! + COLS[i + 1]!) / 2, y - 10, 7, bold));
    line(TL, y - 14, TR, y - 14);
    rulesTop = y - 14;
    y -= 28;
  };
  const finishPage = () => {
    for (const x of COLS.slice(1, -1)) line(x, rulesTop, x, TABLE_BOTTOM);
    line(TL, TABLE_BOTTOM, TR, TABLE_BOTTOM);
    FOOTER.forEach((s, i) => centerAt(s, W / 2, 96 - i * 10, 8, reg));
    centerAt("THANK YOU", W / 2, 70, 11, reg);
  };
  const room = (h: number) => {
    if (y - h >= BOTTOM) return;
    finishPage();
    page = doc.addPage([W, H]);
    y = H - 72;
    header();
  };
  header();
  const SIZE = 11, LEAD = 13.5;
  const sum = summarize(data.lines);
  const rows = invoiceRows(data.lines, sum.estimated);
  const lastRow = rows.length - 1; // invoiceRows drops trailing gaps
  let balanceY = y;
  rows.forEach((r, idx) => {
    if (r.gap) { y -= LEAD; return; }
    const hrsW = r.hrs ? reg.widthOfTextAtSize(clean(r.hrs), SIZE) + 8 : 0;
    const refLines = r.ref ? wrap(reg, SIZE, clean(r.ref), HRS_R - hrsW - REF - (r.hrs ? 0 : -4)) : [""];
    // The balance prints in the BALANCE column beside the last row (two lines), so that row needs room for both.
    room(Math.max(refLines.length, idx === lastRow ? 2 : 1) * LEAD);
    if (idx === lastRow) balanceY = y;
    text(r.date ?? "", DATE_X, y, SIZE);
    if (r.hrs) right(r.hrs, HRS_R, y, SIZE);
    if (r.total) right(r.total, HRS_R, y, SIZE);
    if (r.charges) right(r.charges, CHG_R, y, SIZE);
    if (r.credits) right(r.credits, CRD_R, y, SIZE);
    for (const part of refLines) { text(part, REF, y, SIZE); y -= LEAD; }
  });
  if (lastRow < 0) room(2 * LEAD);
  text("Balance due:", BAL, balanceY, SIZE, bold);
  text(`${balanceText(toCents(data.bill.billbalance))}${sum.estimated ? "(est.)" : ""}`, BAL, balanceY - LEAD, SIZE, bold);
  if (sum.estimated) {
    // Legacy prints the note low in the table; keep it there unless the rows already reach past that spot.
    room((NOTE.length + 1) * LEAD);
    y = Math.min(y - LEAD, BOTTOM + 6 + (NOTE.length - 1) * LEAD);
    text("Note:", DATE_X + 8, y, SIZE);
    for (const s of NOTE) { text(s, REF + 3, y, SIZE); y -= LEAD; }
  }
  finishPage();
  return doc.save();
}

/** Storage key `bills/<caseid>/<billfilename>.pdf`; storage keys are ASCII-only, so accents are stripped and anything else odd dropped. */
export const invoiceKey = (caseid: number, filename: string): string =>
  `bills/${caseid}/${keySafe(filename)}.pdf`;

/**
 * This bill's file name, never one another bill already owns. The stored name is kept unless another bill on the case
 * has the same billfilename or already stores its PDF at the same key (billpdfpath — this also catches two names that
 * differ only in characters invoiceKey drops); then — and for a bill with no stored name — the legacy rule takes the
 * first free `-N` (MakeBillWordDoc's Dir() loop). Only OTHER bills count, so re-creating a bill's own PDF keeps its
 * key and overwrites only itself.
 */
async function ownFileName(db: Db, data: InvoiceData): Promise<string> {
  const { bill } = data;
  const r = await db.from("tblbills").select("billid, billfilename, billpdfpath").eq("billcaseid", bill.billcaseid);
  if (r.error) throw new Error(`tblbills read: ${r.error.message}`);
  const others = ((r.data ?? []) as { billid: number; billfilename: string | null; billpdfpath: string | null }[])
    .filter((o) => o.billid !== bill.billid);
  const taken = (name: string) => {
    const key = invoiceKey(bill.billcaseid, name);
    return others.some((o) => o.billfilename === name || o.billpdfpath === key);
  };
  if (bill.billfilename !== null && !taken(bill.billfilename)) return bill.billfilename;
  const base = bill.billfilename?.replace(/-\d+$/, "") ?? billFileName(bill.billcaseid, data.attyLastName, bill.billdate, 0).slice(0, -2);
  return firstFreeName(base, taken);
}

/**
 * Render and store one bill's invoice under a key no other bill uses (ownFileName), then set `billpdfpath` and
 * `billfilename`, guarded on the finalize stamp that was read. Regenerating overwrites only this bill's own key.
 * ponytail: read-then-write, not atomic — two same-case PDFs saved in the same instant can still pick one name; add a
 * unique index on billpdfpath if concurrent Create PDF ever matters. Returns the key.
 */
export async function saveInvoicePdf(db: Db, storage: StorageAdapter | null, billid: number, cfg: InvoiceConfig): Promise<string> {
  if (!storage) throw new InvoiceError("storage");
  const data = await loadInvoice(db, billid);
  const filename = await ownFileName(db, data);
  const key = invoiceKey(data.bill.billcaseid, filename);
  await storage.putFile(key, await renderInvoice(data, cfg), "application/pdf");
  const upd = await db.from("tblbills").update({ billpdfpath: key, billfilename: filename })
    .eq("billid", billid).eq("billfinalizedat", data.bill.billfinalizedat!).select("billid");
  if (upd.error) throw new Error(`tblbills pdf path: ${upd.error.message}`);
  if ((upd.data ?? []).length !== 1) throw new InvoiceError("stale");
  return key;
}

export type CreatePdfDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  storage: () => StorageAdapter | null;
  config: () => InvoiceConfig;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => never;
};

/** Body of the Create PDF server action (admin). Success → /bills/<id>?saved=1; refusal → /bills/<id>?error=<code>. */
export async function runCreatePdf(billid: number, deps: CreatePdfDeps): Promise<void> {
  let code: string | null = null;
  try {
    await deps.session();
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else throw e;
  }
  if (!code && (!Number.isSafeInteger(billid) || billid <= 0)) code = "notfound";
  if (!code) {
    try {
      await saveInvoicePdf(deps.db(), deps.storage(), billid, deps.config());
    } catch (e) {
      if (e instanceof InvoiceError) code = e.code === "notfound" ? "notfound" : `pdf-${e.code}`;
      else {
        console.error("createBillPdf:", billid, e);
        code = "pdf-failed";
      }
    }
  }
  deps.revalidatePath(`/bills/${billid}`);
  deps.redirect(code ? `/bills/${billid}?error=${code}` : `/bills/${billid}?saved=1`);
}
