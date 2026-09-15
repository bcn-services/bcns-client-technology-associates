import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { firmToday } from "@/lib/cases/presets";
import { listActiveTypes } from "@/lib/expenses/types";
import { EXPENSE_FIELDS, type ExpenseForm as Values } from "@/lib/expenses/save";
import { ExpenseForm } from "../expense-form";
import { createExpense } from "../actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** New expense: blank case = firm-wide; `?case=` prefills the case. On error the redirect echoes every field. */
export default async function NewExpensePage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const db = createServerClient() as unknown as Db;
  const [types, people] = await Promise.all([
    listActiveTypes(db),
    db.from("tblbillingnames").select("personid, initials").order("initials").then((r: { data: unknown }) => (r.data ?? []) as { personid: number; initials: string }[]),
  ]);
  const error = first(searchParams.error);
  const echo = Object.fromEntries(EXPENSE_FIELDS.map((k) => [k, first(searchParams[k])])) as Values;
  const values: Values = error ? echo : { ...echo, date: firmToday(new Date()), branch: "Stratford" };
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">New expense</h1>
      <ExpenseForm action={createExpense} values={values} types={types} people={people} error={error} />
    </main>
  );
}
