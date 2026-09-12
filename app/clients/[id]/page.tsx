import { ContactEditPage } from "@/lib/contacts/pages";

export const dynamic = "force-dynamic";

// "/clients/new" lands here with id "new" — the create screen.
export default function Page({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string; error?: string } }) {
  return <ContactEditPage kind="client" idParam={params.id} flash={searchParams} />;
}
