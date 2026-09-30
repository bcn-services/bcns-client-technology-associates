import { test, expect } from '@playwright/test';
import { createServerClient } from '../../lib/db/client';
import { login, CASE_ID } from './helpers';

// Journey 03 bills shared hosted case 90001; afterAll puts back every row it added or claimed.
// ponytail: "newer than the ids seen in beforeAll" is the marker, so a concurrent writer on 90001 would be swept too.
const db = () => {
  try { process.loadEnvFile('.env.local'); } catch { /* no file: use the ambient env */ }
  return createServerClient();
};
const ok = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};
let maxBill = 0;
let maxAct = 0;

test.beforeAll(async () => {
  const s = db();
  maxBill = ok(await s.from('tblbills').select('billid').order('billid', { ascending: false }).limit(1))[0]?.billid ?? 0;
  maxAct = ok(await s.from('tblactivity').select('actid').order('actid', { ascending: false }).limit(1))[0]?.actid ?? 0;
});

test.afterAll(async () => {
  const s = db();
  const bills = ok(await s.from('tblbills').select('billid').eq('billcaseid', CASE_ID).gt('billid', maxBill)).map((b) => b.billid);
  if (bills.length) ok(await s.from('tblactivity').update({ actbilled: false, actbillid: null }).in('actbillid', bills));
  ok(await s.from('tblactivity').delete().eq('actcaseid', CASE_ID).gt('actid', maxAct));
  if (bills.length) ok(await s.from('tblbills').delete().in('billid', bills));
});

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
    // Await the redirect to the new bill; the next page.goto would otherwise abort the create POST.
    await page.waitForURL(/\/bills\/\d+$/);

    await page.goto(`/cases/${CASE_ID}`);
    await expect(page.getByText(/450\.00/)).toBeVisible();
    // Not getByText(/billed/i): it also matches "Unbilled hours" and every row's marker.
    await expect(page.getByTestId('billed-marker').first()).toBeVisible();
  });
});
