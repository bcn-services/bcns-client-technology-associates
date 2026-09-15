import { test, expect } from '@playwright/test';
import { createServerClient } from '../../lib/db/client';
import { login, CASE_ID } from './helpers';
import path from 'node:path';

// Journey 05 needs an active "Filing Fee" type and a retired type, and a fresh import each run (the unique key
// dedupes a rerun into "nothing to review"); before and after, it removes the fixture's transactions and the expense it confirmed.
// ponytail: "newer than the max expid seen in beforeAll" is the marker, so a concurrent writer on 90001 would be swept too.
const db = () => {
  try { process.loadEnvFile('.env.local'); } catch { /* no file: use the ambient env */ }
  return createServerClient();
};
const ok = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};
const FIXTURE_TX = ['COURT FILING FEE', 'PROCESS SERVER CO'];
const created: number[] = [];
let maxExp = 0;

const clearFixture = async () => {
  const s = db();
  ok(await s.from('bank_transactions').delete().in('description', FIXTURE_TX).in('postedon', ['2026-01-15', '2026-01-16']));
  ok(await s.from('tblexpenses').delete().eq('expcaseid', CASE_ID).gt('expid', maxExp));
};

test.beforeAll(async () => {
  const s = db();
  maxExp = ok(await s.from('tblexpenses').select('expid').order('expid', { ascending: false }).limit(1))[0]?.expid ?? 0;
  await clearFixture();
  const have = ok(await s.from('tblexptype').select('exptype').eq('exptype', 'Filing Fee').eq('active', true));
  const add = [...(have.length ? [] : [{ exptype: 'Filing Fee', active: true }]), { exptype: 'Retired Journey Type', active: false }];
  created.push(...ok(await s.from('tblexptype').insert(add).select('exptypeid')).map((t) => t.exptypeid));
});

test.afterAll(async () => {
  await clearFixture();
  if (created.length) ok(await db().from('tblexptype').delete().in('exptypeid', created));
});

test.describe('Bank of America card export uploaded → transaction reviewed, expense type assigned (retired types hidden, never deleted) → shows on the case ledger and clears against the bank account', () => {
  test('an imported bank transaction becomes a cleared expense on the case ledger', async ({ page }) => {
    await login(page, 'admin');

    await page.goto('/bank-review');
    await page.getByLabel(/upload csv/i).setInputFiles(path.join(__dirname, 'fixtures', 'boa-export.csv'));
    await page.getByRole('button', { name: /^import$/i }).click();
    await expect(page.getByTestId('import-result')).toContainText(/2 transactions imported/i);

    // One review form per transaction: scope to the filing-fee row.
    const row = page.getByRole('form', { name: /review court filing fee/i });
    await row.getByLabel(/case/i).fill(String(CASE_ID));
    const expenseType = row.getByLabel(/expense type/i);
    await expenseType.selectOption({ label: 'Filing Fee' });
    await expect(expenseType.getByRole('option', { name: /retired/i })).toHaveCount(0);

    await row.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByTestId('confirm-result')).toContainText(/cleared/i);

    await page.goto(`/expenses?case=${CASE_ID}`);
    const ledgerRow = page.getByRole('row', { name: /filing fee/i });
    await expect(ledgerRow.getByRole('cell', { name: 'Filing Fee', exact: true })).toBeVisible();
    await expect(ledgerRow.getByRole('cell', { name: 'Yes', exact: true })).toBeVisible();
  });
});
