import { test, expect } from '@playwright/test';
import { login, CASE_ID } from './helpers';
import path from 'node:path';

test.describe('Bank of America card export uploaded → transaction reviewed, expense type assigned (retired types hidden, never deleted) → shows on the case ledger and clears against the bank account', () => {
  test('an imported bank transaction becomes a cleared expense on the case ledger', async ({ page }) => {
    await login(page, 'admin');

    await page.goto('/bank-review');
    await page.getByLabel(/upload|csv/i).setInputFiles(path.join(__dirname, 'fixtures', 'boa-export.csv'));
    await expect(page.getByText(/transaction/i)).toBeVisible();

    await page.getByLabel(/case/i).fill(String(CASE_ID));
    const expenseType = page.getByLabel(/expense type/i);
    await expenseType.selectOption({ label: /filing fee/i });
    await expect(expenseType.getByRole('option', { name: /retired/i })).toHaveCount(0);

    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText(/cleared/i)).toBeVisible();

    await page.goto(`/expenses?case=${CASE_ID}`);
    await expect(page.getByText(/filing fee/i)).toBeVisible();
  });
});
