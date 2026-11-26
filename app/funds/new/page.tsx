import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { firmToday } from "@/lib/cases/presets";
import { DEFAULT_BRANCH, FUNDS_FIELDS, DEFAULT_FUNDS_TYPE, billParam, caseFundsDefaults, type FundsValues } from "@/lib/funds/save";
import { createFundsAction } from "../actions";
import { FundsForm } from "../funds-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Record funds received. `?case=` prefills the case; a refusal comes back as `?error=<code>&<fields>`. */
export default async function NewFundsPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const error = first(searchParams.error);
  const caseId = /^\d{1,9}$/.test(first(searchParams.case)) ? Number(first(searchParams.case)) : 0;
  // Attorney (source column)/Description start from the case's attorney and title (only on a fresh form; an error echo keeps what was typed).
  const fromCase = !error && caseId ? await caseFundsDefaults(createServerClient() as unknown as Db, caseId).catch(() => ({ source: "", description: "" })) : { source: "", description: "" };
  const values = error
    ? (Object.fromEntries(FUNDS_FIELDS.map((k) => [k, first(searchParams[k])])) as FundsValues)
    : ({ ...Object.fromEntries(FUNDS_FIELDS.map((k) => [k, ""])), case: first(searchParams.case), date: firmToday(new Date()), branch: DEFAULT_BRANCH, type: DEFAULT_FUNDS_TYPE, ...fromCase } as FundsValues);
  const bill = billParam(first(searchParams.bill));
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <p className="text-sm"><Link href="/funds" className="text-slate-700 underline">← Funds</Link></p>
      <h1 className="text-xl font-semibold">Record funds</h1>
      {/* Key on a host element: a key on a server component (FundsForm) is dropped from the RSC payload. */}
      <div key={crypto.randomUUID()}>
        <FundsForm values={values} error={error || undefined} action={createFundsAction} submitLabel="Record funds" bill={bill} prefill />
      </div>
    </main>
  );
}
