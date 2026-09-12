import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { DEFAULT_ENGINEER, DEFAULT_HOW_HEARD, loadInquiryOptions, todayIso } from "@/lib/inquiries/inquiries";
import { createInquiryAction } from "../actions";
import { InquiryForm } from "../inquiry-form";

export const dynamic = "force-dynamic";

export default async function NewInquiryPage() {
  await requireSession();
  const options = await loadInquiryOptions(createServerClient());
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">New inquiry</h1>
        <Link href="/inquiries" className="text-sm text-slate-600 hover:underline">All inquiries</Link>
      </div>
      <InquiryForm
        action={createInquiryAction}
        options={options}
        values={{ inqdate: todayIso(), inqhowheardaboutus: DEFAULT_HOW_HEARD, inqengineer: DEFAULT_ENGINEER }}
      />
    </main>
  );
}
