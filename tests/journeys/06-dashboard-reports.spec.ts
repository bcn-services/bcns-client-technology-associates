import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Partner opens dashboard → sees due/overdue/waiting/unpaid by priority → runs P&L, YearlyExpense, and accountant export for a date range', () => {
  test('dashboard shows priority sections and reports return non-empty results', async ({ page }) => {
    await login(page, 'admin');

    await page.goto('/dashboard');
    await expect(page.getByText(/due/i)).toBeVisible();
    await expect(page.getByText(/overdue/i)).toBeVisible();
    await expect(page.getByText(/waiting/i)).toBeVisible();
    await expect(page.getByText(/unpaid/i)).toBeVisible();

    await page.goto('/reports');
    await page.getByLabel(/start date/i).fill('2026-01-01');
    await page.getByLabel(/end date/i).fill('2026-06-30');

    await page.getByRole('button', { name: /p&l|profit/i }).click();
    await expect(page.getByTestId('report-results')).not.toBeEmpty();

    await page.getByRole('button', { name: /yearly ?expense/i }).click();
    await expect(page.getByTestId('report-results')).not.toBeEmpty();

    await page.getByRole('button', { name: /accountant export/i }).click();
    await expect(page.getByTestId('report-results')).not.toBeEmpty();
  });
});
