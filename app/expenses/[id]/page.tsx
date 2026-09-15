import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { listActiveTypes } from "@/lib/expenses/types";
import { EXPENSE_FIELDS, formOf, getExpense, type ExpenseForm as Values } from "@/lib/expenses/save";
import { ExpenseForm } from "../expense-form";
import { updateExpense } from "../actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Edit one expense. Unknown id → 404. No delete control, by rule. */
export default async function ExpensePage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const id = Number(params.id);
  const db = createServerClient() as unknown as Db;
  const [row, types, people] = await Promise.all([
    getExpense(db, id),
    listActiveTypes(db),
    db.from("tblbillingnames").select("personid, initials").order("initials").then((r: { data: unknown }) => (r.data ?? []) as { personid: number; initials: string }[]),
  ]);
  if (!row) notFound();
  const error = first(searchParams.error);
  const values: Values = error ? (Object.fromEntries(EXPENSE_FIELDS.map((k) => [k, first(searchParams[k])])) as Values) : formOf(row);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Expense #{id}</h1>
      {first(searchParams.saved) && <p role="status" className="text-sm text-green-700">Saved.</p>}
      <ExpenseForm action={updateExpense.bind(null, id)} values={values} types={types} keepType={row.exptype} people={people} error={error} />
    </main>
  );
}
