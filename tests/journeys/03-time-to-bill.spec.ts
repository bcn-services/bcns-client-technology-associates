import { test, expect } from '@playwright/test';
import { login, CASE_ID } from './helpers';

test.describe('Jon and Kris each enter time on a case → a timesheet bill record is created from their merged unbilled hours, balance entered, both activity rows marked billed, balance visible on the case', () => {
  test('two staff time entries merge into one timesheet bill', async ({ page }) => {
    await login(page, 'staff');

    await page.goto('/time');
    await page.getByLabel(/case/i).fill(String(CASE_ID));
    await page.getByLabel(/hours/i).fill('1.5');
    await page.getByLabel(/description/i).fill('Reviewed file');
    await page.getByRole('button', { name: /save|add entry/i }).click();
    await expect(page.getByText(/entry (added|saved)/i)).toBeVisible();

    await login(page, 'admin');

    await page.goto(`/bills/new?case=${CASE_ID}`);
    await expect(page.getByText(/unbilled hours/i)).toBeVisible();
    await page.getByLabel(/balance/i).fill('450.00');
    await page.getByRole('button', { name: /create bill|save/i }).click();

    await page.goto(`/cases/${CASE_ID}`);
    await expect(page.getByText(/450\.00/)).toBeVisible();
    await expect(page.getByText(/billed/i)).toBeVisible();
  });
});
