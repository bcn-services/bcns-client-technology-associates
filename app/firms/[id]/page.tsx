import { ContactEditPage } from "@/lib/contacts/pages";

export const dynamic = "force-dynamic";

// "/firms/new" lands here with id "new" — the create screen.
export default function Page({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string; error?: string } }) {
  return <ContactEditPage kind="firm" idParam={params.id} flash={searchParams} />;
}
