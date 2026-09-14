import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { expTypeErrorMessage, listAllTypes } from "@/lib/expenses/types";
import { addExpenseType, reactivateExpenseType, retireExpenseType } from "../actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Expense types admin. Staff see a notice and no controls. */
export default async function ExpenseTypesPage({ searchParams }: { searchParams: Params }) {
  const session = await requireSession();
  if (session.role !== "admin") {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-semibold">Expense types</h1>
        <p className="text-sm text-slate-600">Only admins can manage expense types.</p>
      </main>
    );
  }
  const types = await listAllTypes(createServerClient() as unknown as Db);
  const error = first(searchParams.error);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Expense types</h1>
      {error && <p role="alert" className="text-sm text-red-700">{expTypeErrorMessage(error)}</p>}
      {/* Keyed per render: a same-URL redirect must remount the form so the name input clears. */}
      <form key={Date.now()} action={addExpenseType} className="flex gap-2">
        <label className="sr-only" htmlFor="name">New type name</label>
        <input id="name" name="name" required maxLength={50} className="rounded border px-2 py-1 text-sm" placeholder="New type name" />
        <button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Add type</button>
      </form>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-600"><th className="py-1">Type</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {types.map((t) => {
            const live = t.active === true;
            return (
              <tr key={t.exptypeid} className="border-t">
                <td className="py-1">{t.exptype}</td>
                <td>{live ? "Active" : <span className="text-slate-500">Retired</span>}</td>
                <td className="text-right">
                  <form action={live ? retireExpenseType : reactivateExpenseType}>
                    <input type="hidden" name="id" value={t.exptypeid} />
                    <button className="text-sm underline">{live ? "Retire" : "Reactivate"}</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
