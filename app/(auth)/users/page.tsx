import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { CreateUserForm } from "./create-form";
import { RowControls } from "./row-controls";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Admin check before any profiles query — staff get a ForbiddenError, not the list.
  await requireSession("admin");

  const db = createServerClient();
  const [{ data: profiles, error }, { data: billingRows, error: billingError }] = await Promise.all([
    db.from("profiles").select("id, email, role, personid").order("email"),
    // Legitimately empty until the migration lane loads tblbillingnames.
    db.from("tblbillingnames").select("personid, initials").order("initials"),
  ]);
  if (error) throw new Error(`profiles: ${error.message}`);
  // Non-critical: a failed dropdown read must not block role/deactivate management.
  if (billingError) console.error(`/users: tblbillingnames read failed: ${billingError.message}`);
  const billing = billingError ? [] : billingRows ?? [];
  const initials = new Map(billing.map((b) => [b.personid, b.initials]));

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
            <th className="py-2">Manage</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} data-user-id={p.id} className="border-b border-slate-100 align-top">
              <td className="py-2">{p.email}</td>
              <td className="py-2">{p.role}</td>
              <td className="py-2">{p.personid == null ? "" : initials.get(p.personid) ?? ""}</td>
              <td className="py-2">
                <RowControls userId={p.id} email={p.email} role={p.role} personid={p.personid} billing={billing} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
