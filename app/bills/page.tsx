import { createServerClient } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import type { Db } from "@/lib/time/entries";
import { runBillsList } from "@/lib/bills/list";
import { BillsListView } from "./bills-list-view";

export const dynamic = "force-dynamic";

/** Open bills by notice stage — staff and admin read it; nothing on it writes (admins get Send notice links). */
export default async function BillsPage() {
  const [session, groups] = await Promise.all([requireSession(), runBillsList({ db: createServerClient() as unknown as Db, now: new Date() })]);
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Open bills</h1>
      <BillsListView groups={groups} admin={session.role === "admin"} />
    </main>
  );
}
