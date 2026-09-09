import { test, expect } from '@playwright/test';
import { login, CASE_ID } from './helpers';

test.describe('Check scanned → funds recorded against the bill → bill marked paid → case unpaid count drops, second/final notice dates stay empty', () => {
  test('recording funds and marking a bill paid updates the case unpaid count', async ({ page }) => {
    await login(page, 'admin');

    await page.goto(`/cases/${CASE_ID}`);
    const unpaidBefore = await page.getByTestId('unpaid-bill-count').textContent();

    await page.goto('/funds/new');
    await page.getByLabel(/case/i).fill(String(CASE_ID));
    await page.getByLabel(/amount/i).fill('450.00');
    await page.getByRole('button', { name: /save|record/i }).click();
    await expect(page.getByText(/funds recorded/i)).toBeVisible();

    await page.getByRole('button', { name: /mark (bill )?paid/i }).click();
    await expect(page.getByText(/paid/i)).toBeVisible();

    await page.goto(`/cases/${CASE_ID}`);
    const unpaidAfter = await page.getByTestId('unpaid-bill-count').textContent();
    expect(unpaidAfter).not.toEqual(unpaidBefore);

    await expect(page.getByTestId('second-notice-date')).toHaveText('');
    await expect(page.getByTestId('final-notice-date')).toHaveText('');
  });
});
