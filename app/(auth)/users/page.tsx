import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { CreateUserForm } from "./create-form";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Admin check before any profiles query — staff get a ForbiddenError, not the list.
  await requireSession("admin");

  const db = createServerClient();
  const { data: profiles, error } = await db.from("profiles").select("id, email, role, personid").order("email");
  if (error) throw new Error(`profiles: ${error.message}`);

  const personIds = profiles.flatMap((p) => (p.personid == null ? [] : [p.personid]));
  const initials = new Map<number, string>();
  if (personIds.length) {
    const { data } = await db.from("tblbillingnames").select("personid, initials").in("personid", personIds);
    for (const b of data ?? []) initials.set(b.personid, b.initials);
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <h1 className="text-xl font-semibold">Users</h1>
      <CreateUserForm />
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2">Initials</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} data-user-id={p.id} className="border-b border-slate-100">
              <td className="py-2">{p.email}</td>
              <td className="py-2">{p.role}</td>
              <td className="py-2">{p.personid == null ? "" : initials.get(p.personid) ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
