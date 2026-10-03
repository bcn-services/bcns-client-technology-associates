import { createServerClient } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import type { Db } from "@/lib/time/entries";
import { runBillsList } from "@/lib/bills/list";
import { BillsListView } from "./bills-list-view";

export const dynamic = "force-dynamic";

/** Open bills by notice stage with each bill's state — staff and admin read it; nothing on it writes (admins get Finalize / Send / Send notice links). */
export default async function BillsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const due = searchParams?.due === "1"; // ?due=1 → only open bills past their due date (the dashboard's Due tile)
  const auth = requireSession(); // one check, shared with the read
  const [session, groups] = await Promise.all([auth, runBillsList({ db: createServerClient() as unknown as Db, now: new Date(), session: auth, dueOnly: due })]);
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">{due ? "Due bills" : "Open bills"}</h1>
      <BillsListView groups={groups} due={due}admin={session.role === "admin"} />
    </main>
  );
}
