import { safeReturnTo } from "@/lib/cases/create";
import { ContactEditPage } from "@/lib/contacts/pages";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// "/attorneys/new" lands here with id "new" — the create screen.
export default function Page({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  return <ContactEditPage kind="attorney" idParam={params.id} flash={{ saved: one(searchParams.saved), error: one(searchParams.error), returnTo: safeReturnTo(one(searchParams.returnTo)) ?? undefined }} />;
}
