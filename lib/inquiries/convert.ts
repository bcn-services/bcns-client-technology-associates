/**
 * Inquiry → case (legacy "convert to case"). Reuses item 6's nextCaseId / insertCase; every DB call
 * goes through the injected client so tests use fakes. Two writes, made all-or-nothing by compensation:
 * the case (carrying caseinquiry) first, then tblinquiry.inqresultingcase; if the second fails the case is deleted.
 */
import { insertCase, nextCaseId, type CreateResult } from "../cases/create";
import type { Db, Row } from "../cases/record";
import { fetchAll } from "../contacts/contacts";
import { todayIso } from "./inquiries";

export const NEED_ATTORNEY = "Pick a case attorney before converting.";
export const NEED_CLIENT = "Pick a case client before converting.";
export const NEED_BRANCH = "Pick a case branch before converting.";
export const NO_OPEN_STATUS = 'The case status list has no "Open" status; add it before converting.';
export const ALREADY_CONVERTED = "This inquiry already has a case.";
export const NOT_FOUND = "Inquiry not found.";
export const CONVERT_FAILED = "Convert failed; no case was created.";
/** tblinquiry.inqresultingcase is a smallint: case numbers above this can't be stored there. */
export const SMALLINT_MAX = 32767;

const posInt = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{1,9}$/.test(s) && Number(s) > 0 ? Number(s) : null;
};

/** The case already made from this inquiry: a case pointing at it (caseinquiry), else the inquiry's own inqresultingcase. */
export async function existingCaseId(db: Db, inquiry: { id: number; inqresultingcase?: number | null }): Promise<number | null> {
  const { data, error } = await db.from("tblcase").select("caseid").eq("caseinquiry", inquiry.id).order("caseid").limit(1);
  if (error) throw new Error(`tblcase read: ${error.message}`);
  if (data?.length) return Number(data[0].caseid);
  return inquiry.inqresultingcase == null ? null : Number(inquiry.inqresultingcase);
}

/** The status lookup's own spelling of "Open", or null when the lookup lacks it (the status FK would refuse anything else). */
async function openStatus(db: Db): Promise<string | null> {
  const { data, error } = await db.from("tblcasestatus").select("casestatus");
  if (error) throw new Error(`tblcasestatus read: ${error.message}`);
  const hit = (data ?? []).find((r: Row) => String(r.casestatus).toLowerCase() === "open");
  return hit ? String(hit.casestatus) : null;
}

/**
 * Convert inquiry `inquiryId` using the form's caseatty / caseclient / tabranch. Never throws on user or DB error;
 * raw DB text never reaches the result.
 */
export async function convertInquiry(db: Db, inquiryId: number, form: FormData, now: Date): Promise<CreateResult> {
  const caseatty = posInt(form.get("caseatty"));
  if (caseatty == null) return { ok: false, error: NEED_ATTORNEY };
  const caseclient = posInt(form.get("caseclient"));
  if (caseclient == null) return { ok: false, error: NEED_CLIENT };
  const branchRaw = form.get("tabranch");
  const tabranch = typeof branchRaw === "string" && branchRaw.trim() ? branchRaw.trim() : null;
  if (tabranch == null) return { ok: false, error: NEED_BRANCH };

  try {
    const { data: inq, error } = await db.from("tblinquiry").select("id, inqsubject, inqresultingcase").eq("id", inquiryId).maybeSingle();
    if (error) throw new Error(`tblinquiry read: ${error.message}`);
    if (!inq) return { ok: false, error: NOT_FOUND };
    // Server-side re-check, right before the insert, so a second POST can't make a second case.
    // ponytail: two converts racing past this check together can both insert (no unique key on caseinquiry) — upgrade = RPC with a row lock in a foundation migration.
    if ((await existingCaseId(db, inq)) != null) return { ok: false, error: ALREADY_CONVERTED };
    const status = await openStatus(db);
    if (status == null) return { ok: false, error: NO_OPEN_STATUS };

    const caseid = await nextCaseId(db);
    const subject = typeof inq.inqsubject === "string" && inq.inqsubject.trim() ? inq.inqsubject.trim() : "TBD";
    const created = await insertCase(db, {
      caseid, casetitle: subject, casestartdate: todayIso(now), status, tabranch, caseatty, caseclient, caseinquiry: inquiryId,
    });
    if (!created.ok) return created;

    if (created.id <= SMALLINT_MAX) {
      const { error: upErr } = await db.from("tblinquiry").update({ inqresultingcase: created.id }).eq("id", inquiryId);
      if (upErr) {
        // Compensate: no case without its inquiry link.
        // ponytail: a crash between the two writes leaves an orphan case — upgrade = one-transaction RPC in a foundation migration.
        console.error(`convertInquiry ${inquiryId}: inquiry update failed, deleting case ${created.id}:`, upErr);
        const { error: delErr } = await db.from("tblcase").delete().eq("caseid", created.id);
        if (delErr) console.error(`convertInquiry ${inquiryId}: compensating delete of case ${created.id} failed:`, delErr);
        return { ok: false, error: CONVERT_FAILED };
      }
    }
    return created;
  } catch (e) {
    console.error(`convertInquiry ${inquiryId}:`, e);
    return { ok: false, error: CONVERT_FAILED };
  }
}

/** Client picker options (all clients, read live), labelled "Last, First" like the case record. */
export async function loadClientOptions(db: Db): Promise<{ id: number; name: string }[]> {
  const rows = await fetchAll(db, "tblclient", "clientid, clientfirstname, clientlastname", "clientid");
  return rows
    .map((c) => ({ id: Number(c.clientid), name: [c.clientlastname, c.clientfirstname].filter((x) => x != null && String(x).trim()).join(", ") || `#${c.clientid}` }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
