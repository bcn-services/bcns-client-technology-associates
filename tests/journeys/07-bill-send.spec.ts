// SAFETY: run this journey only with RESEND_API_URL pointed at a local stub. Never run it with real
// Resend keys against the real API: it would email real staff from an unverified domain. The stub and
// the assertion that the email reached it arrive in billing-output item 8.
import { test, expect } from '@playwright/test';
import { createServerClient } from '../../lib/db/client';
import { STORAGE_BUCKET } from '../../lib/storage';
import { login, CASE_ID } from './helpers';

// Journey 07 finalizes and sends its own timesheet bill on shared case 90001: one bill plus two
// billed activity rows (fixture people 1 and 2). afterAll removes the bill's lines, its PDF, the
// activity rows and the bill, so a rerun starts the same way. Email: with no RESEND_API_KEY the Send
// button stays disabled — this journey expects a local stack with email configured against the stub above.
const db = () => {
  try { process.loadEnvFile('.env.local'); } catch { /* no file: use the ambient env */ }
  return createServerClient();
};
const ok = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};
const NEW_RATE = '399.00'; // invented; differs from every legacy default ($435/$475 × billingfactor)
let billId = 0;
let actIds: number[] = [];

test.beforeAll(async () => {
  const s = db();
  billId = ok(await s.from('tblbills').insert({
    billcaseid: CASE_ID, billdate: '2026-09-01', billhours: 0, billbalance: 0, billnotice: '1st', billtype: 'timesheet',
  }).select('billid').single()).billid;
  actIds = ok(await s.from('tblactivity').insert([
    { actcaseid: CASE_ID, actdate: '2026-08-10', actdescription: 'Journey 07 site inspection', acthrs: 2.0, actwho: 1, actbilled: true, actbillid: billId },
    { actcaseid: CASE_ID, actdate: '2026-08-11', actdescription: 'Journey 07 photo review', acthrs: 1.5, actwho: 2, actbilled: true, actbillid: billId },
  ]).select('actid')).map((a) => a.actid);
});

test.afterAll(async () => {
  if (!billId) return;
  const s = db();
  const bill = ok(await s.from('tblbills').select('billpdfpath').eq('billid', billId).single());
  if (bill.billpdfpath) await s.storage.from(STORAGE_BUCKET).remove([bill.billpdfpath]);
  ok(await s.from('tblbilllines').delete().eq('billid', billId)); // before the bill: on delete restrict
  if (actIds.length) ok(await s.from('tblactivity').delete().in('actid', actIds));
  ok(await s.from('tblbills').delete().eq('billid', billId));
});

test.describe("Admin finalizes a timesheet bill with one person's rate changed → previews the PDF and the email → sends → PDF stored on the case, the charged rates saved on the bill (added 2026-09-21)", () => {
  test("finalize with one rate changed, preview, send, PDF and rates stored", async ({ page }) => {
    test.setTimeout(90_000); // a cold `next dev` compiles login + /bills/[id] on first hit (~30s seen)
    await login(page, 'admin');

    await page.goto(`/bills/${billId}`);
    // RED today: the bill page has no Finalize control yet (billing-output item 3).
    await page.getByRole('link', { name: /finalize/i }).or(page.getByRole('button', { name: /finalize/i })).first().click({ timeout: 10_000 });
    await page.waitForURL(new RegExp(`/bills/${billId}/finalize`));

    // One rate box per person; change only person 1's (fixture initials KJS).
    await page.getByLabel(/rate.*KJS|KJS.*rate/i).fill(NEW_RATE);
    await page.getByRole('button', { name: /save|finalize/i }).click();
    await page.waitForURL(new RegExp(`/bills/${billId}(\\?.*)?$`));

    await page.goto(`/bills/${billId}/send`);
    await expect(page.getByLabel(/^to$/i)).toBeVisible();
    await expect(page.getByLabel(/subject/i)).toHaveValue(/^Re: /);
    await expect(page.getByRole('link', { name: /\.pdf|view pdf|open pdf/i })).toBeVisible();
    await page.getByLabel(/^to$/i).fill('pat@example.test'); // fixture attorney 1 has no attyemail
    await page.getByLabel(/^cc$/i).fill(''); // never the configured BILL_CC_EMAIL (a real staff address)
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText(/sent .* to /i)).toBeVisible();

    const s = db();
    const bill = ok(await s.from('tblbills').select('billfinalizedat,billpdfpath,billsentat,billsentto').eq('billid', billId).single());
    expect(bill.billfinalizedat).not.toBeNull();
    expect(bill.billpdfpath).toMatch(new RegExp(`^bills/${CASE_ID}/.+\\.pdf$`));
    expect(bill.billsentat).not.toBeNull();
    expect(bill.billsentto).toBeTruthy();

    const lines = ok(await s.from('tblbilllines').select('personid,rate').eq('billid', billId).not('personid', 'is', null));
    const rateOf = (p: number) => [...new Set(lines.filter((l) => l.personid === p).map((l) => Number(l.rate)))];
    expect(rateOf(1)).toEqual([Number(NEW_RATE)]);
    expect(rateOf(2)).toHaveLength(1);
    expect(rateOf(2)[0]).not.toBe(Number(NEW_RATE)); // the other person keeps their default

    await page.goto(`/cases/${CASE_ID}`);
    await expect(page.getByRole('link', { name: /\.pdf|download|pdf/i }).first()).toBeVisible();
  });
});
