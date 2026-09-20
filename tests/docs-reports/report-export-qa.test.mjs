// QA (independent of the engineer's report-export.test.mjs): every assertion here reads the SERIALISED
// workbook back with exceljs, never the in-memory object the builder returned. A plan that looks right and a
// buffer Excel will actually open are different claims.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs"; // CJS package: the named export is not reachable from a .mjs
const { Workbook } = ExcelJS;
import { fakeDb } from "./fakedb.mjs";

const { buildWorkbook } = await import("../../lib/reports/export.ts");
const { findPreset, runPreset, MONTHS } = await import("../../lib/reports/presets.ts");

const FULL = { start: "2025-01-01", end: "2025-12-31" };
const MARCH = { start: "2025-03-01", end: "2025-03-31" };

// Awkward cents on purpose: 0.07 / 19.93 / 0.01 cannot be hit by a float-rounding mutant by luck.
const exp = (expid, expdate, exptype, expamount) => ({
  expid, expdate, exptype, expamount, exp_notcountedinprofit: null,
  expcaseid: 55, expbranch: "Main", expdscr: `vendor ${expid}`, expreason: "reason", expchecknum: 12, expinit: 3,
});
const fnd = (fndsid, fndsdate, fndspmt) => ({
  fndsid, fndsdate, fndspmt, fndsbranch: "Main", fndscaseid: 55, fndspayee: "Acme", fndsdesc: `receipt ${fndsid}`,
});
const world = () => ({
  tblexpenses: [exp(101, "2025-01-15", 9, 0.07), exp(102, "2025-03-10", 9, 19.93), exp(103, "2025-03-20", 6, 0.01), exp(104, "2025-11-04", 6, 12.34)],
  tblfundsrcvd: [fnd(201, "2025-01-15", 0.07), fnd(202, "2025-03-10", 19.93), fnd(203, "2025-03-20", 0.29), fnd(204, "2025-09-02", 5.11)],
  tblexptype: [{ exptypeid: 9, exptype: "Active Type", active: true }, { exptypeid: 6, exptype: "Quiet Type", active: true }],
  tblbillingnames: [{ personid: 3, initials: "KB", billingfactor: 1 }],
  tblcase: [{ caseid: 55, caseatty: 900 }],
  tblattorney: [{ attyid: 900, attylastname: "Stone", attyfirstname: "Jon" }],
});

/** Build, serialise, and read the bytes back — this is the workbook the browser would actually download. */
const roundTrip = async (presetKey, range) => {
  const wb = await buildWorkbook(fakeDb(world()), findPreset(presetKey), range);
  const buf = await wb.xlsx.writeBuffer();
  const back = new Workbook();
  await back.xlsx.load(buf);
  return back;
};

// done-when 1 — 27 sheets, and the RIGHT 27, read back off the serialised buffer.
test("QA1 accountant export round-trips to exactly the expected 27 sheets, in order", async () => {
  const back = await roundTrip("accountant-export", FULL);
  const names = back.worksheets.map((ws) => ws.name);
  const expected = [
    ...MONTHS.map((m) => `Monthly Income Report ${m} 2025`),
    ...MONTHS.map((m) => `Monthly Expense Report ${m} 2025`),
    "Yearly Income Report 2025", "Yearly Expense Report 2025", "P&L 2025",
  ];
  assert.equal(names.length, 27, `got ${names.length} sheets: ${names.join(" | ")}`);
  assert.deepEqual(names, expected);
  assert.equal(new Set(names).size, 27, "duplicate sheet name survived serialisation");
  for (const n of names) {
    assert.ok(n.length <= 31, `sheet name over Excel's 31-char limit (${n.length}): ${n}`);
    assert.ok(!/[*?:\\/[\]]/.test(n), `illegal character in sheet name: ${n}`);
    assert.ok(n.trim() === n && n.length > 0, `blank or padded sheet name: "${n}"`);
  }
});

// The item names these explicitly: no legacy Access field name may appear ANYWHERE in the workbook.
test("QA2 no legacy Access field name appears in any cell of the 27-sheet workbook", async () => {
  const back = await roundTrip("accountant-export", FULL);
  const hits = [];
  for (const ws of back.worksheets) {
    ws.eachRow((row, n) => {
      for (const v of row.values.slice(1)) {
        if (typeof v === "string" && /FndsBranch|ExpDscr|FndsDesc|ExpReason|ExpChecknum/i.test(v)) hits.push(`${ws.name}!row${n}: ${v}`);
      }
    });
  }
  assert.deepEqual(hits, [], `legacy Access field names reached the workbook:\n${hits.join("\n")}`);
});

// done-when 2 — a single report's figures equal the on-screen panel's runPreset output to the cent, and are
// NUMBERS with a currency format after a serialisation round trip (a column-level numFmt can be lost on save).
test("QA3 monthly-expense cells survive serialisation as numbers with a currency format, matching the panel", async () => {
  const expected = await runPreset(fakeDb(world()), findPreset("monthly-expense"), MARCH);
  const ws = (await roundTrip("monthly-expense", MARCH)).worksheets[0];
  assert.ok(expected.data.rows.length >= 2, "fixture must put more than one expense in March");

  expected.data.rows.forEach((r, i) => {
    const cell = ws.getRow(2 + i).getCell(7);
    assert.equal(typeof cell.value, "number", `row ${i}: amount is a ${typeof cell.value}, not a number`);
    assert.equal(Math.round(cell.value * 100), r.amountCents, `row ${i}: workbook cent value differs from the panel`);
    assert.ok(cell.numFmt && /0\.00/.test(cell.numFmt), `row ${i}: no currency numFmt after round trip (got ${cell.numFmt})`);
  });
  const total = ws.getRow(2 + expected.data.rows.length).getCell(7);
  assert.equal(typeof total.value, "number");
  assert.equal(Math.round(total.value * 100), expected.data.totalCents, "total cent value differs from the panel");
  // Guard the guard: if the engine ever stopped carrying cents this test would silently compare 0 to 0.
  assert.ok(expected.data.totalCents > 0, "fixture guard: March total must be non-zero");
});

// done-when 2, rollups — every accountant rollup sheet's money is numeric and matches its own runPreset call.
test("QA4 rollup sheets in the combined workbook match their own engine output to the cent", async () => {
  const back = await roundTrip("accountant-export", FULL);
  const pnlWs = back.worksheets[26];
  const pnl = await runPreset(fakeDb(world()), findPreset("pnl"), FULL);
  const netRow = pnlWs.getRow(4);
  assert.equal(netRow.getCell(1).value, "Net");
  assert.equal(Math.round(netRow.getCell(14).value * 100), pnl.data.total.netCents, "P&L year net");

  const yiWs = back.worksheets[24];
  const yi = await runPreset(fakeDb(world()), findPreset("yearly-income"), FULL);
  const totalRow = yiWs.getRow(2 + yi.data.rows.length);
  assert.equal(Math.round(totalRow.getCell(14).value * 100), yi.data.totals.totalCents, "Yearly Income grand total");
  for (const c of [2, 14]) assert.ok(/0\.00/.test(yiWs.getRow(2).getCell(c).numFmt ?? ""), `column ${c} lost its currency format`);

  // A combined-workbook month sheet must carry only that month: March income sheet total == March alone.
  const marchIncome = back.worksheets[MONTHS.indexOf("Mar")];
  assert.equal(marchIncome.name, "Monthly Income Report Mar 2025");
  const march = await runPreset(fakeDb(world()), findPreset("monthly-income"), MARCH);
  const mTotal = marchIncome.getRow(2 + march.data.rows.length).getCell(7);
  assert.equal(Math.round(mTotal.value * 100), march.data.totalCents);
  assert.ok(march.data.totalCents !== pnl.data.total.incomeCents, "fixture guard: March must differ from the year");
});

// Guardrail — the export reads the SAME engine output the screen renders. Proved by the query trace: the
// statements buildWorkbook issues for a preset are exactly the ones runPreset issues for it, in order.
test("QA5 buildWorkbook issues exactly the queries runPreset issues, and never writes", async () => {
  // The fake's builder returns itself from every method, so one wrapper records the whole statement.
  const trace = (db) => {
    const calls = [];
    const wrap = (b) => {
      const w = { then: (res, rej) => b.then(res, rej) };
      for (const k of Object.keys(b)) {
        if (k === "then") continue;
        w[k] = (...a) => { calls.push(`${k}(${JSON.stringify(a)})`); b[k](...a); return w; };
      }
      return w;
    };
    return { db: { from: (t) => { calls.push(`from ${t}`); return wrap(db.from(t)); }, get writes() { return db.writes; } }, calls };
  };
  for (const key of ["monthly-expense", "yearly-income", "pnl"]) {
    const a = trace(fakeDb(world()));
    const b = trace(fakeDb(world()));
    await buildWorkbook(a.db, findPreset(key), MARCH);
    await runPreset(b.db, findPreset(key), MARCH);
    assert.deepEqual(a.calls, b.calls, `${key}: export's query trace diverges from the panel's`);
  }
  const db = fakeDb(world());
  await buildWorkbook(db, findPreset("accountant-export"), FULL);
  assert.equal(db.writes, 0, "the export issued a write statement");
  assert.ok(db.reads > 0, "the export issued no reads at all — fixture or fake is wrong");
});

// Guardrail — no engine, no query and no arithmetic lives in export.ts; it may only lay runPreset output out.
test("QA6 lib/reports/export.ts re-derives nothing and imports no engine", async () => {
  const src = readFileSync(new URL("../../lib/reports/export.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/from "@\/lib\/reports\/presets"/.test(code), "export.ts must source its figures from presets.ts");
  assert.ok(/runPreset\(/.test(code), "export.ts must call runPreset");
  for (const bad of [/@\/lib\/reports\/detail/, /@\/lib\/reports\/matrix/, /@\/lib\/reports\/pnl/, /\.from\(/, /\bselect\(/, /\breduce\(/, /\+=/]) {
    assert.ok(!bad.test(code), `export.ts queries or re-derives (matched ${bad}) — it must only lay out runPreset output`);
  }
  // Currency may only come from an integer-cents field, never parsed out of a display string.
  for (const bad of [/parseFloat/, /parseInt/, /replace\(\/\[\$,\]/]) assert.ok(!bad.test(code), `export.ts parses money out of a string (matched ${bad})`);
  assert.ok(/Cents\b/.test(code), "export.ts must read the integer-cents fields");
});
