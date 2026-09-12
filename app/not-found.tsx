import Link from "next/link";

// Rendered inside the root layout, so the header nav stays usable for sections not built yet.
export default function NotFound() {
  return (
    <main className="space-y-3">
      <h1 className="text-2xl font-semibold text-slate-900">Not built yet</h1>
      <p className="text-slate-600">This section doesn&apos;t exist yet. Use the navigation above to go elsewhere.</p>
      <Link href="/" className="text-sm text-slate-700 underline">
        Back to home
      </Link>
    </main>
  );
}
