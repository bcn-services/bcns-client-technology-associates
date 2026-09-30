/**
 * The four case documents (legacy frmCaseUpdate cmdMakeMemo / cmdMakeReport / cmdMakeSummary / cmdMakeInspectionList):
 * the kind list the route and the case page both read, and the bookmark map Access would have filled for a case.
 * Kept light on purpose — the case page imports CASE_DOCS, so nothing here pulls in jszip, pdf-lib or the templates.
 *
 * Divergence from Access, deliberately: a case with no attorney (or an attorney with no firm) still yields a map, the
 * missing values empty — the Memo's INNER JOIN made Access error instead.
 */
import type { TemplateName } from "./templates";
import { labelLines, type LabelAttorney, type LabelFirm } from "@/lib/cases/search";
import { firmToday } from "@/lib/cases/presets";
import { loadAttorneyWithFirm } from "@/lib/contacts/contacts";

export type CaseDocSlug = "memo" | "cta-report" | "file-review-summary" | "inspection-plan";
export type CaseDoc = { slug: CaseDocSlug; label: string; template: TemplateName; fileName: (caseId: number) => string };

const doc = (slug: CaseDocSlug, label: string, template: TemplateName): CaseDoc =>
  ({ slug, label, template, fileName: (caseId) => `${label} ${caseId}.docx` });

/** The one definition of the four kinds, in case-page order. */
export const CASE_DOCS: readonly CaseDoc[] = [
  doc("memo", "Memo", "CTA_Memo"),
  doc("cta-report", "CTA Report", "CTA_REPORT"),
  doc("file-review-summary", "File Review Summary", "File_Review_Summary"),
  doc("inspection-plan", "Inspection Plan", "Inspection_Plan"),
];
export const caseDoc = (slug: string): CaseDoc | undefined => CASE_DOCS.find((d) => d.slug === slug);

type Db = { from(table: string): any };
type Row = Record<string, unknown>;
const nz = (v: unknown): string => (v == null ? "" : String(v));

/** Port of modGeneric.FormatAttyName, blanks and all (a non-Esq. name is always prefixed "<title> ", even a blank title). */
export function formatAttyName(first: string, middle: string, last: string, esq: boolean, title: string, suffix: string): string {
  let s = "";
  if (first !== "") s = first;
  if (middle !== "" && first === "") s = `${middle.slice(0, 1)}.`;
  else if (middle !== "") s = `${s} ${middle.slice(0, 1)}.`;
  if (last !== "" && first === "" && middle === "") s = last;
  else if (last !== "") s = `${s} ${last}`;
  if (suffix !== "" && s !== "") s = `${s}, ${suffix}`;
  return esq ? `${s}, Esq.` : `${title} ${s}`;
}

/** Port of modGeneric.FormatAddress; vbCrLf → "\n" (the fill engine makes it a Word line break). */
export function formatAddress(add1: string, add2: string, city: string, state: string, zip: string): string {
  let s = "";
  if (add1 !== "") s = add1;
  if (add2 !== "") s = `${s}\n${add2}`;
  if (city !== "" || state !== "" || zip !== "") {
    if (s !== "") s += "\n";
    if (city !== "") s += `${city}, `;
    if (state !== "") s += `${state} `;
    if (zip.length > 5 && zip[5] !== "-") s += `${zip.slice(0, 5)}-${zip.slice(5)}`;
    else if (zip.length === 6 && zip[5] === "-") s += zip.slice(0, 5);
    else s += zip;
  }
  return s;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** VBA `Format$(Date, "mmmm dd, yyyy")` for the firm's today — "September 05, 2026". */
export function todayText(now: Date): string {
  const [y, m, d] = firmToday(now).split("-");
  return `${MONTHS[Number(m) - 1]} ${d}, ${y}`;
}

/** The bookmark → text map Access would fill for this case and kind; null when the case doesn't exist. */
export async function loadCaseDocValues(db: Db, caseId: number, slug: CaseDocSlug, now: Date): Promise<Record<string, string> | null> {
  const { data: k, error } = await db.from("tblcase").select("caseid, casetitle, casecaption, caseatty").eq("caseid", caseId).maybeSingle();
  if (error) throw new Error(`tblcase read: ${error.message}`);
  if (!k) return null;
  const caseID = nz(k.caseid), title = nz(k.casetitle);
  if (slug === "inspection-plan") return { CaseTitle: title, CaseID: caseID }; // bookmarks in the page header
  if (slug === "file-review-summary") return { CaseTitle: title, CaseID: caseID, TodayDate: todayText(now) };

  const af = k.caseatty == null ? null : await loadAttorneyWithFirm(db, Number(k.caseatty));
  const a: Row | null = af?.atty ?? null, f: Row | null = af?.firm ?? null;
  // ContactInfo — the same address block the invoice prints for BM_Address.
  if (slug === "cta-report") return { Atty: labelLines(a as LabelAttorney | null, f as LabelFirm | null).join("\n"), Title: title, CaseID: caseID };
  return {
    Atty: a ? formatAttyName(nz(a.attyfirstname), nz(a.attymiddlename), nz(a.attylastname), a.attyesq === true, nz(a.attytitle), nz(a.attysuffix)) : "",
    Firm: nz(f?.frmname),
    Address: f ? formatAddress(nz(f.frmaddress1), nz(f.frmaddress2), nz(f.frmcity), nz(f.frmstate), nz(f.frmzip)) : "",
    TodayDate: todayText(now),
    TitleCaption: `${nz(k.casecaption)}, ${title}`,
  };
}
