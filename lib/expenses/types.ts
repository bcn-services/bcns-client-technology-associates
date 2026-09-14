// Expense types (tblexptype). Retire is a flag flip: nothing here deletes a type or touches tblexpenses.
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";

export type ExpType = { exptypeid: number; exptype: string; active: boolean | null };

export class ExpTypeError extends Error {
  constructor(public code: "forbidden" | "name" | "notfound") {
    super(code);
    this.name = "ExpTypeError";
  }
}

const MESSAGES: Record<string, string> = {
  forbidden: "Only admins can change expense types.",
  name: "Type name is required (up to 50 characters).",
  notfound: "That expense type no longer exists.",
};
export const expTypeErrorMessage = (code: string) => MESSAGES[code] ?? "Save failed; nothing was changed.";

/** Types offered on money forms: `active = true` only — legacy `null` counts as retired. */
export async function listActiveTypes(db: Db): Promise<ExpType[]> {
  const { data, error } = await db.from("tblexptype").select("exptypeid, exptype, active").eq("active", true).order("exptype");
  if (error) throw error;
  return data ?? [];
}

/** Admin page: every type, retired included. */
export async function listAllTypes(db: Db): Promise<ExpType[]> {
  const { data, error } = await db.from("tblexptype").select("exptypeid, exptype, active").order("exptype");
  if (error) throw error;
  return data ?? [];
}

export async function addType(db: Db, name: string): Promise<void> {
  const exptype = name.trim();
  if (!exptype || exptype.length > 50) throw new ExpTypeError("name");
  const { error } = await db.from("tblexptype").insert({ exptype, active: true });
  if (error) throw error;
}

async function setActive(db: Db, id: number, active: boolean): Promise<void> {
  const { data, error } = await db.from("tblexptype").update({ active }).eq("exptypeid", id).select("exptypeid");
  if (error) throw error;
  if (!data?.length) throw new ExpTypeError("notfound");
}
export const retireType = (db: Db, id: number) => setActive(db, id, false);
export const reactivateType = (db: Db, id: number) => setActive(db, id, true);

export type TypeDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/** Shared action body: admin check first (before any DB call), then the op; result goes back as ?error= / ?saved=. */
async function run(op: (db: Db, formData: FormData) => Promise<void>, where: string, formData: FormData, deps: TypeDeps): Promise<void> {
  let code: string | null = null;
  try {
    const session = await deps.session();
    if (session.role !== "admin") throw new ExpTypeError("forbidden");
    await op(deps.db(), formData);
  } catch (e) {
    if (e instanceof ExpTypeError) code = e.code;
    else if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else {
      console.error(`${where}:`, e); // raw DB text stays in the server log
      code = "failed";
    }
  }
  deps.revalidatePath("/expenses/types");
  deps.redirect(code ? `/expenses/types?error=${code}` : "/expenses/types?saved=1");
}

const idOf = (formData: FormData): number => {
  const raw = formData.get("id");
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw) || Number(raw) <= 0) throw new ExpTypeError("notfound");
  return Number(raw);
};
const nameOf = (formData: FormData) => (typeof formData.get("name") === "string" ? String(formData.get("name")) : "");

export const runAddType = (formData: FormData, deps: TypeDeps) => run((db, f) => addType(db, nameOf(f)), "addType", formData, deps);
export const runRetireType = (formData: FormData, deps: TypeDeps) => run((db, f) => retireType(db, idOf(f)), "retireType", formData, deps);
export const runReactivateType = (formData: FormData, deps: TypeDeps) => run((db, f) => reactivateType(db, idOf(f)), "reactivateType", formData, deps);
