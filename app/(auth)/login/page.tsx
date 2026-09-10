import { signIn } from "./actions";
import { safeNext } from "@/lib/auth/safe-next";

const ERRORS: Record<string, string> = {
  invalid: "Invalid email or password.",
  deactivated: "This account is deactivated — ask an admin.",
  unavailable: "Sign-in is unavailable right now. Please try again later.",
};

type Props = { searchParams: { next?: string | string[]; error?: string | string[] } };

const input = "w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200";

export default function LoginPage({ searchParams }: Props) {
  const next = safeNext(searchParams.next);
  const code = typeof searchParams.error === "string" ? searchParams.error : undefined;
  const message = code ? ERRORS[code] ?? ERRORS.invalid : undefined;

  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {message && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {message}
          </p>
        )}
        <form action={signIn} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className={input} />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
          </div>
          <button type="submit" className="w-full rounded bg-slate-800 px-3 py-2 font-medium text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
