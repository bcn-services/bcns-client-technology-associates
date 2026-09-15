import { test, expect } from '@playwright/test';
import { createServerClient } from '../../lib/db/client';
import { login, CASE_ID } from './helpers';

// Journey 04 pays its own open `1st` bill on shared hosted case 90001 (the fixture bill's `First` notice
// isn't open); afterAll removes that bill and the funds row it recorded, so a rerun starts the same way.
// ponytail: "newer than the max fndsid seen in beforeAll" is the marker, so a concurrent writer on 90001 would be swept too.
const db = () => {
  try { process.loadEnvFile('.env.local'); } catch { /* no file: use the ambient env */ }
  return createServerClient();
};
const ok = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};
let billId = 0;
let maxFunds = 0;

test.beforeAll(async () => {
  const s = db();
  maxFunds = ok(await s.from('tblfundsrcvd').select('fndsid').order('fndsid', { ascending: false }).limit(1))[0]?.fndsid ?? 0;
  billId = ok(await s.from('tblbills').insert({
    billcaseid: CASE_ID, billdate: '2026-09-01', billhours: 0, billbalance: 450, billnotice: '1st', billtype: 'timesheet',
  }).select('billid').single()).billid;
});

test.afterAll(async () => {
  const s = db();
  ok(await s.from('tblfundsrcvd').delete().eq('fndscaseid', CASE_ID).gt('fndsid', maxFunds));
  if (billId) ok(await s.from('tblbills').delete().eq('billid', billId));
});

test.describe('Check scanned → funds recorded against the bill → bill marked paid → case unpaid count drops, second/final notice dates stay empty', () => {
  test('recording funds and marking a bill paid updates the case unpaid count', async ({ page }) => {
    await login(page, 'admin');

    await page.goto(`/cases/${CASE_ID}`);
    const unpaidBefore = await page.getByTestId('unpaid-bill-count').textContent();

    // The bills panel's "Record payment" link: case filled, this bill preselected on the saved funds page.
    await page.goto(`/funds/new?case=${CASE_ID}&bill=${billId}`);
    await page.getByLabel(/amount/i).fill('450.00');
    await page.getByRole('button', { name: /record funds/i }).click();
    await expect(page.getByText(/funds recorded/i)).toBeVisible();

    await page.getByRole('button', { name: /mark bill paid/i }).click();
    await expect(page.getByTestId('pay-saved')).toBeVisible();

    await page.goto(`/cases/${CASE_ID}`);
    const unpaidAfter = await page.getByTestId('unpaid-bill-count').textContent();
    expect(unpaidAfter).not.toEqual(unpaidBefore);

    await expect(page.getByTestId('second-notice-date')).toHaveText('');
    await expect(page.getByTestId('final-notice-date')).toHaveText('');
  });
});
