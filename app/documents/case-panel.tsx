import Link from "next/link";
import { requireSession, type Session } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getStorageAdapter } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import { listCaseDocuments, type DocRow } from "@/lib/documents/store";
import { UploadForm } from "./upload-form";

/** Loads the case's documents; a failed read renders a note instead of breaking the case page. */
export async function CaseDocumentsPanel({ caseId, db, session, storageReady }: {
  caseId: number;
  db?: Db;
  session?: Pick<Session, "role">;
  storageReady?: boolean;
}) {
  const s = session ?? (await requireSession());
  const d = db ?? (createServerClient() as unknown as Db);
  const ready = storageReady ?? getStorageAdapter() !== null;
  const docs = await listCaseDocuments(d, s, caseId).catch((e) => { console.error("case documents read:", e); return null; });
  return <CaseDocumentsPanelView caseId={caseId} docs={docs} storageReady={ready} />;
}

export function CaseDocumentsPanelView({ caseId, docs, storageReady }: { caseId: number; docs: DocRow[] | null; storageReady: boolean }) {
  return (
    <section id="documents-panel" data-testid="documents-panel" className="space-y-2 rounded border border-slate-200 p-3">
      <h2 className="font-semibold">Documents</h2>
      {/* An empty list is only trustworthy when storage is actually configured; otherwise
          "no documents" would be a silent wrong answer for a misconfiguration. */}
      {!storageReady && (
        <p role="alert" className="text-sm text-red-700">Document storage is not configured — uploads and downloads are unavailable.</p>
      )}
      {docs == null ? (
        <p className="text-sm text-red-700">Documents could not be loaded.</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate-500">No documents on this case</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Added</th><th className="font-normal">File</th><th className="font-normal">Kind</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id} data-testid="case-document" data-caseid={doc.caseid ?? ""} className="border-t border-slate-100">
                <td className="py-1">{doc.dateadded ?? ""}</td>
                {/* `?case=` scopes the request to the case being viewed; it can only narrow
                    access — the download re-derives the real caseid from the row. */}
                <td><Link href={`/documents/${doc.id}/download?case=${caseId}`} className="underline">{doc.description ?? `Document ${doc.id}`}</Link></td>
                <td>{doc.type ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <UploadForm caseId={caseId} disabled={!storageReady} />
    </section>
  );
}
