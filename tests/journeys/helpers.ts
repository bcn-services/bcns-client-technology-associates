import type { Page } from '@playwright/test';

export const CASE_ID = 90001;

export async function login(page: Page, role: 'admin' | 'staff'): Promise<void> {
  const email = process.env.E2E_EMAIL ?? 'staff@example.test';
  const password = process.env.E2E_PASSWORD ?? 'password';

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  void role; // role is currently determined by the seeded account, not selectable at login
}
