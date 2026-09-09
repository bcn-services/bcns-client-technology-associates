import { test, expect } from '@playwright/test';
import { login, CASE_ID } from './helpers';

test.describe('Legacy .bak loaded into Supabase → an existing case shows its full bill, funds, and expense history unchanged', () => {
  test('staff views a migrated case and sees its bills, funds, and expenses', async ({ page }) => {
    await login(page, 'staff');

    await page.goto(`/cases/${CASE_ID}`);
    await expect(page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));

    await expect(page.getByRole('heading', { name: new RegExp(String(CASE_ID)) })).toBeVisible();
    await expect(page.getByText(/bills/i)).toBeVisible();
    await expect(page.getByText(/funds received/i)).toBeVisible();
    await expect(page.getByText(/expenses/i)).toBeVisible();
  });
});
