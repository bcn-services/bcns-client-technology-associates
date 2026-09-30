/**
 * The 2nd / Final notice PDF (billing-output item 6): the bill's STORED invoice bytes with the legacy stamp image drawn
 * on page 1 — never a re-render, so the figures are exactly what was first sent. Legacy (Form_frmBillUnpaid Email_Click):
 * AddPicture(<stamp>.png, ..., Width 120, Height 35), then Left 150 / Top 250 points relative to the page, exported as
 * `<bill file> SecondNotice.pdf` / `FinalNotice.pdf` beside the bill.
 */
import { PDFDocument } from "pdf-lib";
import type { Db } from "@/lib/time/entries";
import { NOTICE_STAMPS } from "@/lib/bills/rules";
import { STAMP_PNG } from "./stamps";
import { SendError } from "./send";

/** Stamp box in points, measured from the page's top-left (Word's Left/Top), at the legacy AddPicture size. */
export const STAMP_BOX = { left: 150, top: 250, width: 120, height: 35 } as const;

const stampName = (notice: string) => {
  const name = Object.hasOwn(NOTICE_STAMPS, notice) ? NOTICE_STAMPS[notice] : undefined;
  if (!name) throw new Error(`no notice stamp for "${notice}"`);
  return name;
};

/** The original PDF with the notice's stamp on page 1. `original` is only read (pdf-lib copies it); metadata kept. */
export async function stampNotice(original: Uint8Array, notice: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const img = await doc.embedPng(Buffer.from(STAMP_PNG[stampName(notice)], "base64"));
  const page = doc.getPage(0);
  const { left, top, width, height } = STAMP_BOX;
  page.drawImage(img, { x: left, y: page.getHeight() - top - height, width, height });
  return doc.save();
}

/** `bills/<case>/<file>.pdf` → `bills/<case>/<file> SecondNotice.pdf`: beside the original, never equal to it. */
export const noticeKey = (pdfpath: string, notice: string): string =>
  `${pdfpath.replace(/\.pdf$/i, "")} ${stampName(notice)}.pdf`;

/**
 * Stamp the stored original and save it at noticeKey (overwriting only that notice's own earlier file); returns the
 * attachment. Refuses (SendError "notice-key") if another bill's invoice lives at that key, so no original is ever
 * overwritten. `read`/`write` are the storage seam (readStoredFile / writeStoredFile in the app).
 */
export async function saveNoticePdf(
  db: Db, bill: { billid: number; billpdfpath: string; billnotice: string },
  read: (key: string) => Promise<Uint8Array>, write: (key: string, bytes: Uint8Array) => Promise<void>,
): Promise<{ filename: string; content: Uint8Array }> {
  const key = noticeKey(bill.billpdfpath, bill.billnotice);
  const taken = await db.from("tblbills").select("billid").eq("billpdfpath", key);
  if (taken.error) throw new Error(`tblbills notice key: ${taken.error.message}`);
  if ((taken.data ?? []).length) throw new SendError("notice-key");
  const content = await stampNotice(await read(bill.billpdfpath), bill.billnotice);
  await write(key, content);
  return { filename: key.slice(key.lastIndexOf("/") + 1), content };
}
