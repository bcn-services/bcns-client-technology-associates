import { signIn } from "./actions";
import { safeNext } from "@/lib/auth/safe-next";

const ERRORS: Record<string, string> = {
  invalid: "Invalid email or password.",
  unavailable: "Sign-in is unavailable right now. Please try again later.",
};

type Props = { searchParams: { next?: string | string[]; error?: string | string[] } };

export default function LoginPage({ searchParams }: Props) {
  const next = safeNext(searchParams.next);
  const code = typeof searchParams.error === "string" ? searchParams.error : undefined;
  const message = code ? ERRORS[code] ?? ERRORS.invalid : undefined;

  return (
    <main style={{ maxWidth: "22rem", margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign in</h1>
      {message && (
        <p role="alert" style={{ color: "#b42318" }}>
          {message}
        </p>
      )}
      <form action={signIn} style={{ display: "grid", gap: "0.75rem" }}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
