import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { billErrorMessage } from "@/lib/bills/edit";
import { loadNewBill } from "@/lib/bills/create";
import { createBill } from "../actions";
import { NewBillForm } from "./new-bill-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** New bill on one case. Admin-only form; staff see a notice and no form. */
export default async function NewBillPage({ searchParams }: { searchParams: Params }) {
  const session = await requireSession();
  const raw = first(searchParams.case);
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const error = first(searchParams.error);
  if (session.role !== "admin") {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-semibold">New bill</h1>
        <p className="text-sm text-slate-600">Only admins can create bills.</p>
      </main>
    );
  }
  const data = await loadNewBill(createServerClient() as unknown as Db, Number(raw), new Date());
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">New bill</h1>
      {/* Keyed per render: a same-URL ?error redirect must remount the form with fresh rows/defaults. */}
      <NewBillForm key={Date.now()} data={data} action={createBill} error={error ? billErrorMessage(error) : undefined} />
    </main>
  );
}
