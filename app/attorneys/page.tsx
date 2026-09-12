import { ContactListPage } from "@/lib/contacts/pages";

export const dynamic = "force-dynamic";

export default function Page() {
  return <ContactListPage kind="attorney" />;
}
