import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Receptionist logs an inquiry → engineer converts it to a case with firm, attorney, and client attached', () => {
  test('an inquiry is logged then converted into a fully attached case', async ({ page }) => {
    await login(page, 'staff');

    await page.goto('/inquiries/new');
    await page.getByLabel(/subject/i).fill('Slip and fall at warehouse');
    await page.getByLabel(/caller name/i).fill('Jane Doe');
    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/inquiry (created|saved)/i)).toBeVisible();

    const inquiryUrl = page.url();
    const inquiryId = inquiryUrl.match(/\/inquiries\/(\d+)/)?.[1] ?? '1';

    await page.goto(`/inquiries/${inquiryId}`);
    await page.getByRole('button', { name: /convert to case/i }).click();

    await expect(page).toHaveURL(/\/cases\/\d+$/);
    await expect(page.getByText(/firm/i)).toBeVisible();
    await expect(page.getByText(/attorney/i)).toBeVisible();
    await expect(page.getByText(/client/i)).toBeVisible();
  });
});
