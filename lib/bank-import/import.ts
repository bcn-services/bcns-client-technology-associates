import type { Db } from "../time/entries";
import type { Session } from "../auth/session";
import { parseBoaCsv, type BankRow } from "./parse";

export const DEFAULT_ACCOUNT = "Bank of America";
export const MAX_BYTES = 1_000_000; // Next's default server-action body limit is 1 MB anyway
const KEY = "bankaccount,postedon,amount,description"; // frozen unique key, migration 0004

export type ImportCounts = { imported: number; already: number; credits: number };

export function resultLine(c: ImportCounts): string {
  return `${c.imported} transactions imported, ${c.already} already imported, ${c.credits} credits skipped`;
}

export function importErrorMessage(code: string): string {
  return ({
    account: "Account is required",
    nofile: "Choose a CSV file to upload",
    toobig: "File is larger than 1 MB",
    parse: "Nothing imported — fix the file and upload it again",
    failed: "Import failed; nothing was imported",
  } as Record<string, string>)[code] ?? "Import failed";
}

/**
 * Insert the outflows (amount < 0) into bank_transactions for `account`; credits are counted, never written.
 * One upsert statement with ON CONFLICT DO NOTHING on the frozen key: the unique index is the dedupe guard (so a
 * concurrent double upload neither errors nor double-inserts), the returned rows are exactly the new ones, and a
 * single statement is atomic — a DB error writes nothing. Duplicate lines within one file collide on the key: the
 * second counts as "already imported". Never touches tblexpenses / tblfundsrcvd.
 */
export async function importRows(db: Db, account: string, rows: BankRow[]): Promise<ImportCounts> {
  const outflows = rows.filter((r) => r.amount.startsWith("-"));
  const credits = rows.length - outflows.length;
  if (!outflows.length) return { imported: 0, already: 0, credits };
  // ponytail: one statement for the whole file (≤1 MB ≈ 20k rows) — chunk if the size cap is raised; chunks would lose atomicity.
  const { data, error } = await db.from("bank_transactions")
    .upsert(outflows.map((r) => ({ bankaccount: account, postedon: r.postedon, amount: r.amount, description: r.description })),
      { onConflict: KEY, ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`bank_transactions upsert: ${error.message}`);
  const imported = (data ?? []).length;
  return { imported, already: outflows.length - imported, credits };
}

export type ImportDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/**
 * /bank-review upload action body. Staff and admin may upload (session only). Validates the account and file, parses the
 * whole file, and only then touches the DB — any parse error means no DB call at all. Errors → ?importerror=<code>
 * (parse errors also carry ?importdetail=); success → ?imported=&already=&credits=&account=.
 */
export async function runImportBank(formData: FormData, deps: ImportDeps): Promise<void> {
  await deps.session(); // unauthenticated → /login redirect propagates
  const account = String(formData.get("account") ?? "").trim();
  const file = formData.get("file");
  const q = new URLSearchParams({ account });
  let code: string | null = null;
  let counts: ImportCounts | null = null;
  if (!account) code = "account";
  else if (!(file instanceof Blob) || file.size === 0) code = "nofile";
  else if (file.size > MAX_BYTES) code = "toobig";
  else {
    const parsed = parseBoaCsv(await file.text());
    if (!parsed.ok) {
      code = "parse";
      q.set("importdetail", parsed.errors.slice(0, 5).join("; ") + (parsed.errors.length > 5 ? `; +${parsed.errors.length - 5} more` : ""));
    } else {
      try {
        counts = await importRows(deps.db(), account, parsed.rows);
      } catch (e) {
        console.error("importRows:", e);
        code = "failed";
      }
    }
  }
  if (code) q.set("importerror", code);
  else if (counts) {
    q.set("imported", String(counts.imported));
    q.set("already", String(counts.already));
    q.set("credits", String(counts.credits));
    deps.revalidatePath("/bank-review");
  }
  deps.redirect(`/bank-review?${q}`);
}
