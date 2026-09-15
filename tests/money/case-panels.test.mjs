// Unit tests for the case-page money panels (app/funds/case-panel.tsx, app/expenses/case-panel.tsx) driven through
// the real async panels with the shared fake DB (tests/money/fakedb.mjs applies every filter to every row).
// Fixtures carry a decoy row on another case (catches a dropped case filter), float-drifting amounts (0.10 + 0.20),
// and a funds reversal pair (+125.00 / -125.00 on fndsid -N) that must net to zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDb } from "./fakedb.mjs";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { CaseFundsPanel } = await import("../../app/funds/case-panel.tsx");
const { CaseExpensesPanel } = await import("../../app/expenses/case-panel.tsx");

const CASE = 990901, DECOY = 990902;
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const rows = (h, id) => [...h.matchAll(new RegExp(`<tr data-testid="${id}"[^>]*>(.*?)</tr>`, "g"))].map((m) => text(m[1]));
const testid = (h, id) => { const m = h.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)); assert.ok(m, `${id} present`); return m[1]; };

const fnd = (fndsid, fndscaseid, fndspmt, o = {}) => ({ fndsid, fndscaseid, fndsdate: "2026-09-01", fndspmt, fndstype: "Retainer", fndspayee: `Payee ${fndsid}`, fndsclearedbank: false, ...o });
const FUNDS = [
  fnd(1, CASE, "0.10", { fndsclearedbank: true }),
  fnd(2, CASE, "0.20"),
  fnd(3, CASE, "125.00"),
  fnd(-3, CASE, "-125.00", { fndstype: "Bounced" }),
  fnd(4, DECOY, "999.99", { fndspayee: "Decoy payee" }),
];
const exp = (expid, expcaseid, expamount, o = {}) => ({ expid, expcaseid, expdate: "2026-09-02", exptype: 7, expdscr: `Vendor ${expid}`, expchecknum: 0, expamount, expclearedbank: false, ...o });
const EXPENSES = [
  exp(11, CASE, "0.10", { expclearedbank: true }),
  exp(12, CASE, "0.20"),
  exp(13, DECOY, "888.88", { expdscr: "Decoy vendor" }),
];
const TYPES = [{ exptypeid: 7, exptype: "Filing fee" }];

const fundsHtml = async (tables = { tblfundsrcvd: FUNDS.map((r) => ({ ...r })) }) => renderToStaticMarkup(await CaseFundsPanel({ caseId: CASE, db: fakeDb(tables) }));
const expHtml = async () => renderToStaticMarkup(await CaseExpensesPanel({ caseId: CASE, db: fakeDb({ tblexpenses: EXPENSES.map((r) => ({ ...r })), tblexptype: TYPES }) }));

test("funds panel lists only this case's rows (decoy case absent), reversal row included with a negative-id link", async () => {
  const h = await fundsHtml();
  const r = rows(h, "case-funds");
  assert.equal(r.length, 4, r.join(" | "));
  assert.ok(!h.includes("Decoy payee") && !h.includes("999.99"), "decoy case row not listed");
  assert.ok(r.some((l) => l.includes("Bounced / Payee -3") && l.includes("-125.00")), r.join(" | "));
  assert.ok(h.includes('href="/funds/-3"'), "reversal row links to /funds/-3");
  assert.ok(r.some((l) => l.includes("2026-09-01") && l.includes("Retainer / Payee 1") && l.includes("0.10") && l.includes("Cleared")), "cleared row");
  assert.ok(!rows(h, "case-funds").find((l) => l.includes("Payee 2")).includes("Cleared"), "false → not cleared");
});

test("funds total is exact cents and the reversal pair nets to zero: 0.10 + 0.20 + 125.00 - 125.00 = 0.30", async () => {
  assert.equal(testid(await fundsHtml(), "funds-total"), "0.30");
});

test("funds panel Add link prefills the case; empty case shows a note and still the link", async () => {
  assert.ok((await fundsHtml()).includes(`href="/funds/new?case=${CASE}"`));
  const h = await fundsHtml({ tblfundsrcvd: [fnd(4, DECOY, "1.00")] });
  assert.match(text(h), /No funds on this case/);
  assert.ok(h.includes(`href="/funds/new?case=${CASE}"`));
});

test("expenses panel lists only this case's rows (decoy case absent) with type/payee, amount, cleared", async () => {
  const h = await expHtml();
  const r = rows(h, "case-expense");
  assert.equal(r.length, 2, r.join(" | "));
  assert.ok(!h.includes("Decoy vendor") && !h.includes("888.88"), "decoy case row not listed");
  assert.ok(r.some((l) => l.includes("2026-09-02") && l.includes("Filing fee / Vendor 11") && l.includes("0.10") && l.includes("Cleared")), r.join(" | "));
  assert.ok(!r.find((l) => l.includes("Vendor 12")).includes("Cleared"), "false → not cleared");
  assert.ok(h.includes('href="/expenses/12"'));
});

test("expenses total is exact cents: 0.10 + 0.20 = 0.30", async () => {
  assert.equal(testid(await expHtml(), "expenses-total"), "0.30");
});

test("expenses panel Add link prefills the case", async () => {
  assert.ok((await expHtml()).includes(`href="/expenses/new?case=${CASE}"`));
});

test("case-page selector traps: one heading each, no buttons, no inputs, no 'billed'", async () => {
  for (const [h, name] of [[await fundsHtml(), "Funds received"], [await expHtml(), "Expenses"]]) {
    assert.deepEqual([...h.matchAll(/<h\d[^>]*>([^<]*)</g)].map((m) => m[1]), [name]);
    assert.ok(!/<button|<input|<select/.test(h) && !/billed/i.test(text(h)));
  }
});
