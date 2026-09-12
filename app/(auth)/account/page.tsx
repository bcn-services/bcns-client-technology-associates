import { requireSession } from "@/lib/auth/session";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <h1 className="text-xl font-semibold">Account</h1>
      <p className="text-sm text-slate-600">Signed in as {session.email}</p>
      <PasswordForm />
    </main>
  );
}
