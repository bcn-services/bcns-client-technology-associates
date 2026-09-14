import type { Page } from '@playwright/test';

export const CASE_ID = 90001;

// Accounts come from `pnpm exec tsx tests/app-shell/seed-e2e.ts`, which seeds both.
export async function login(page: Page, role: 'admin' | 'staff'): Promise<void> {
  const email = role === 'admin' ? process.env.E2E_ADMIN_EMAIL ?? 'admin@example.test' : process.env.E2E_EMAIL ?? 'staff@example.test';
  const password = (role === 'admin' ? process.env.E2E_ADMIN_PASSWORD : process.env.E2E_PASSWORD) ?? 'password';

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Await the post-sign-in redirect; a caller's next page.goto would otherwise abort the sign-in POST.
  await page.waitForURL((url) => url.pathname !== '/login');
}
