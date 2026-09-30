import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getStorageAdapter } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import { listAllDocuments } from "@/lib/documents/store";

export const dynamic = "force-dynamic";

/** Every uploaded document, newest first, each linked to its case. Read-only. */
export default async function DocumentsPage() {
  const [session, db] = [await requireSession(), createServerClient() as unknown as Db];
  const docs = await listAllDocuments(db, session).catch((e) => { console.error("documents read:", e); return null; });
  const storageReady = getStorageAdapter() !== null;
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Documents</h1>
      {!storageReady && (
        <p role="alert" className="text-sm text-red-700">Document storage is not configured — downloads are unavailable.</p>
      )}
      {docs == null ? (
        <p className="text-sm text-red-700">Documents could not be loaded.</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate-500">No documents yet. Upload one from a case page.</p>
      ) : (
        <table className="w-full text-sm" data-testid="documents-list">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Added</th><th className="font-normal">File</th><th className="font-normal">Kind</th><th className="font-normal">Case</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id} data-testid="document-row" className="border-t border-slate-100">
                <td className="py-1">{doc.dateadded ?? ""}</td>
                <td><Link href={`/documents/${doc.id}/download`} className="underline">{doc.description ?? `Document ${doc.id}`}</Link></td>
                <td>{doc.type ?? ""}</td>
                <td>{doc.caseid == null ? "" : <Link href={`/cases/${doc.caseid}`} className="underline">{doc.caseid}</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
