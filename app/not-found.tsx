import Link from "next/link";

// Rendered inside the root layout, so the header nav stays usable from a bad link.
export default function NotFound() {
  return (
    <main className="space-y-3">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-slate-600">That page doesn&apos;t exist. Check the address, or use the navigation above.</p>
      <Link href="/" className="text-sm text-slate-700 underline">
        Back to home
      </Link>
    </main>
  );
}
