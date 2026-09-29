/**
 * Invoice PDF (billing-output item 4) — the legacy `MakeBillWordDoc` layout drawn with pdf-lib from a FINALIZED
 * bill's STORED lines (`tblbilllines`). Never re-prices: every figure printed is a stored line's description/amount
 * or the bill's stored `billbalance`; nothing here imports rates.ts or the pricing engine's price functions.
 *
 * Formats follow the VBA: activity and payment rows `M/D/YY`, the retainer row `mm/dd/yy`, estimate rows "TBD",
 * activity hours `Format(x, "fixed")` (2 decimals), money `#,###` (whole dollars), document date `mmmm dd, yyyy`.
 * Letterhead and TAX ID come from config (BILL_LETTERHEAD / BILL_TAX_ID); unset → that row is not drawn.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { StorageAdapter } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { toCents, fmtCents } from "@/lib/expenses/list";
import { labelLines, type LabelAttorney, type LabelFirm } from "@/lib/cases/search";
import { brokenFinalize, storedLines } from "@/lib/bills/finalize";
import { summarize, type BillLine } from "@/lib/bills/lines";
import { billFileName } from "@/lib/bills/rules";

export type InvoiceConfig = { letterhead?: string[]; taxId?: string };
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
const ymd = (d: string) => d.slice(0, 10).split("-").map(Number) as [number, number, number];
/** VBA `M/D/YY`. */
export const mdyy = (d: string | null): string => { if (!d) return ""; const [y, m, day] = ymd(d); return `${m}/${day}/${String(y % 100).padStart(2, "0")}`; };
/** VBA `mm/dd/yy` (the retainer row). */
export const mmddyy = (d: string | null): string => { if (!d) return ""; const [y, m, day] = ymd(d); return [m, day, y % 100].map((n) => String(n).padStart(2, "0")).join("/"); };
/** VBA `mmmm dd, yyyy` — "September 07, 2026". */
export const longDate = (d: string): string => { const [y, m, day] = ymd(d); return `${MONTHS[m - 1]} ${String(day).padStart(2, "0")}, ${y}`; };
/** VBA `#,###`: cents → whole dollars, half away from zero, with commas; 0 → "0" (VBA would print nothing). */
export const dollars = (c: number): string => fmtCents(Math.sign(c) * Math.floor((Math.abs(c) + 50) / 100) * 100).slice(0, -3);
/** Balance due: whole dollars when whole, else dollars and cents — never hides a stored cent. */
const balanceText = (c: number): string => `${c < 0 ? "-" : ""}$${c % 100 === 0 ? dollars(Math.abs(c)) : fmtCents(Math.abs(c))}`;
/** VBA `Format(h, "fixed")`: thousandths → 2 decimals, half-up. */
const fixed2 = (t: number): string => { const h = Math.floor((t + 5) / 10); return `${Math.trunc(h / 100)}.${String(h % 100).padStart(2, "0")}`; };

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
  "THANK YOU",
];
const INK = rgb(0.2, 0.2, 0.22);
// Letter page, points. Columns: date, reference, hours, charges (right edge), credits (right edge), balance.
const W = 612, H = 792, L = 54, R = 558, REF = 112, HRS = 330, TOTAL_R = 390, CHG_R = 445, CRD_R = 505, BAL = 512, BOTTOM = 96;

/** Standard fonts are WinAnsi-only: keep what the font encodes, strip accents from the rest, else "?". Control chars → space. */
function cleaner(font: PDFFont): (s: string) => string {
  const ok = new Set(font.getCharacterSet());
  const one = (ch: string) => (ok.has(ch.codePointAt(0)!) ? ch : null);
  return (s) => [...s.replace(/\p{Cc}/gu, " ")]
    .map((ch) => one(ch) ?? ([...ch.normalize("NFKD").replace(/\p{M}/gu, "")].map((c) => one(c) ?? "?").join("") || "?"))
    .join("");
}

/** Greedy word wrap to `width` (pass CLEANED text — the width lookup throws on non-WinAnsi); a single over-long word is left whole. */
function wrap(font: PDFFont, size: number, s: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(next, size) > width) { out.push(cur); cur = w; } else cur = next;
  }
  return out.length || cur ? [...out, cur] : [""];
}

/** Draw the invoice. Pure: no DB, no clock, no env. */
export async function renderInvoice(data: InvoiceData, cfg: InvoiceConfig): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${data.bill.billid}`);
  const reg = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const clean = cleaner(reg);
  let page: PDFPage = doc.addPage([W, H]);
  const text = (s: string, x: number, y: number, size = 11, font = reg) => { if (s) page.drawText(clean(s), { x, y, size, font, color: INK }); };
  const right = (s: string, xr: number, y: number, size = 11, font = reg) => text(s, xr - font.widthOfTextAtSize(clean(s), size), y, size, font);
  const center = (s: string, y: number, size: number, font: PDFFont) => text(s, (W - font.widthOfTextAtSize(clean(s), size)) / 2, y, size, font);
  const footer = () => FOOTER.forEach((s, i) => center(s, 64 - i * 12, 9, bold));

  let y = H - 54;
  (cfg.letterhead ?? []).forEach((s, i) => { center(s, y, i === 0 ? 14 : 10, i === 0 ? bold : reg); y -= i === 0 ? 16 : 12; });
  y -= 18;
  text("INVOICE", L, y, 18, bold);
  if (cfg.taxId) right(`TAX ID: ${cfg.taxId}`, R, y, 11, bold);
  y -= 40;
  let left = y, rt = y;
  data.address.forEach((s, i) => { text(s, L, left, 11, i === 0 ? bold : reg); left -= 13; });
  const RX = 340;
  const block: [string, PDFFont, number][] = [
    [`DATE: ${longDate(data.bill.billdate)}`, reg, 0], ["", reg, 0], [`RE: ${data.casetitle}`, bold, 0],
    ...(data.casecaption?.trim() ? [[data.casecaption, reg, 14] as [string, PDFFont, number]] : []),
    [`Our File No.: ${data.bill.billcaseid}`, reg, 14],
  ];
  for (const [s, f, indent] of block) for (const part of wrap(f, 11, clean(s), R - RX - indent)) { text(part, RX + indent, rt, 11, f); rt -= 13; }
  y = Math.min(left, rt) - 28;

  const header = () => {
    text("DATE", L, y, 9, bold); text("REFERENCE", REF, y, 9, bold);
    right("CHARGES", CHG_R, y, 9, bold); right("CREDITS", CRD_R, y, 9, bold); text("BALANCE", BAL, y, 9, bold);
    page.drawLine({ start: { x: L, y: y - 4 }, end: { x: R, y: y - 4 }, thickness: 0.5, color: INK });
    y -= 20;
  };
  const room = (h: number) => {
    if (y - h >= BOTTOM) return;
    footer();
    page = doc.addPage([W, H]);
    y = H - 72;
    header();
  };
  header();
  const SIZE = 10, LEAD = 12.5;
  const sum = summarize(data.lines);
  for (const r of invoiceRows(data.lines, sum.estimated)) {
    if (r.gap) { y -= LEAD / 2; continue; }
    const refLines = r.ref ? wrap(reg, SIZE, clean(r.ref), (r.hrs ? HRS : CHG_R - 50) - REF - 8) : [""];
    room(refLines.length * LEAD);
    text(r.date ?? "", L, y, SIZE);
    if (r.hrs) text(r.hrs, HRS, y, SIZE);
    if (r.total) right(r.total, TOTAL_R, y, SIZE);
    if (r.charges) right(r.charges, CHG_R, y, SIZE);
    if (r.credits) right(r.credits, CRD_R, y, SIZE);
    for (const part of refLines) { text(part, REF, y, SIZE); y -= LEAD; }
  }
  room(4 * LEAD);
  y -= LEAD;
  right("Balance due:", R, y, 11, bold);
  y -= 14;
  right(`${balanceText(toCents(data.bill.billbalance))}${sum.estimated ? "(est.)" : ""}`, R, y, 11, bold);
  y -= 30;
  if (sum.estimated) {
    room(NOTE.length * LEAD);
    text("Note:", L, y, SIZE, bold);
    for (const s of NOTE) { text(s, REF, y, SIZE); y -= LEAD; }
  }
  footer();
  return doc.save();
}

/** Storage key `bills/<caseid>/<billfilename>.pdf`; storage keys are ASCII-only, so accents are stripped and anything else odd dropped. */
export const invoiceKey = (caseid: number, filename: string): string =>
  `bills/${caseid}/${filename.normalize("NFKD").replace(/[^\w .()&$@=;:+,-]/g, "")}.pdf`;

/** Legacy suffix rule for a bill with no stored name: the lowest `-N` (from 0) no other bill on the case already uses. */
async function freeFileName(db: Db, data: InvoiceData): Promise<string> {
  const { bill } = data;
  const r = await db.from("tblbills").select("billfilename").eq("billcaseid", bill.billcaseid);
  if (r.error) throw new Error(`tblbills read: ${r.error.message}`);
  const used = new Set((r.data ?? []).map((x: { billfilename: string | null }) => x.billfilename));
  let n = 0;
  while (used.has(billFileName(bill.billcaseid, data.attyLastName, bill.billdate, n))) n++;
  return billFileName(bill.billcaseid, data.attyLastName, bill.billdate, n);
}

/**
 * Render and store one bill's invoice, then set `billpdfpath` (and `billfilename` when it was null), guarded on the
 * finalize stamp that was read. Regenerating overwrites the same key. Returns the key.
 */
export async function saveInvoicePdf(db: Db, storage: StorageAdapter | null, billid: number, cfg: InvoiceConfig): Promise<string> {
  if (!storage) throw new InvoiceError("storage");
  const data = await loadInvoice(db, billid);
  const filename = data.bill.billfilename ?? await freeFileName(db, data);
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
