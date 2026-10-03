// The month cap on P&L / accountant-export ranges, through the real page and the real export route.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { fakeDb } from "./fakedb.mjs";
import dbclient from "./stub-dbclient.cjs";
import { render, panel, texts } from "./render.mjs";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const STUBS = { "@/lib/auth/session": here("./stub-session.cjs"), "@/lib/db/client": here("./stub-dbclient.cjs") };
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return STUBS[request] ?? realResolve.call(this, request, ...rest); };

const mod = await import("../../app/reports/export/route.ts");
const GET = (mod.default?.GET ? mod.default : mod).GET;

const get = (qs) => GET(new Request(`http://localhost:3100/reports/export?${qs}`));
const EMPTY = () => ({ tblexpenses: [], tblfundsrcvd: [], tblexptype: [], tblbillingnames: [], tblcase: [], tblattorney: [] });

test("route: a 27-year P&L or accountant export is a 400 and never reads the database", async () => {
  for (const preset of ["pnl", "accountant-export"]) {
    const db = fakeDb(EMPTY());
    dbclient.state.db = db;
    const res = await get(`start=2000-01-01&end=2026-12-31&preset=${preset}`);
    assert.equal(res.status, 400, preset);
    assert.equal(db.reads, 0, `${preset} hit the database`);
  }
});

test("route: exactly 24 months is accepted; 25 is refused", async () => {
  dbclient.state.db = fakeDb(EMPTY());
  assert.equal((await get("start=2025-01-01&end=2026-12-31&preset=pnl")).status, 200);
  assert.equal((await get("start=2025-01-01&end=2027-01-01&preset=pnl")).status, 400);
});

test("route: other presets are not capped", async () => {
  dbclient.state.db = fakeDb(EMPTY());
  assert.equal((await get("start=2000-01-01&end=2026-12-31&preset=monthly-expense")).status, 200);
});

test("page: an over-long P&L range shows the invalid-range message, no figures, no export link, no reads", async () => {
  for (const preset of ["pnl", "accountant-export"]) {
    const db = fakeDb(EMPTY());
    const markup = await render(db, { start: "2000-01-01", end: "2026-12-31", preset });
    assert.equal(db.reads, 0);
    assert.ok(texts(panel(markup)).some((t) => /start and end/i.test(t)));
    assert.equal(markup.includes('data-testid="report-export"'), false);
  }
});
