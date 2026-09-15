/**
 * QA (attempt #2) live race on the hosted DB: 3 rounds of two parallel confirms of one transaction each. Every round
 * must leave exactly one tblexpenses row for the tx, and that row must be CLEARED (true, datecleared = posted date,
 * bankaccount = the import account) and linked — the new insert-uncleared → link → clear-by-expid path. Skips without
 * SUPABASE_SERVICE_ROLE_KEY (or the dev server, to match the other live files). after() deletes by the per-run account.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { runConfirmTransaction } from "../../lib/bank-import/confirm.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("").toUpperCase();
const ACCT = `QA Race ${RUN}`;
const DAYS = ["2026-03-02", "2026-03-03", "2026-03-04"];
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
let db, typeid;

before(async () => {
  if (skip) return;
  db = createServerClient();
  typeid = ok(await db.from("tblexptype").insert({ exptype: `QA Race Type ${RUN}`, active: true }).select("exptypeid").single()).exptypeid;
  ok(await db.from("bank_transactions").insert(DAYS.map((d, i) => ({ bankaccount: ACCT, postedon: d, amount: `-${i + 1}1.25`, description: `RACE ${RUN} ${i}` }))));
});
after(async () => {
  if (!db) return;
  ok(await db.from("bank_transactions").delete().eq("bankaccount", ACCT));
  ok(await db.from("tblexpenses").delete().eq("expbankaccount", ACCT));
  ok(await db.from("tblexptype").delete().eq("exptypeid", typeid));
});

test("3× two parallel confirms → each tx has exactly one expense: cleared, datecleared = posted, account = import's, linked", { skip }, async () => {
  const txs = ok(await db.from("bank_transactions").select("*").eq("bankaccount", ACCT).order("postedon"));
  for (const t of txs) {
    const urls = [];
    const deps = { session: async () => ({ userId: "x", email: "x", role: "staff", personId: null }), db: () => db, revalidatePath: () => {}, redirect: (u) => urls.push(u) };
    const fd = () => { const f = new FormData(); f.set("tx", String(t.id)); f.set("type", String(typeid)); f.set("case", ""); f.set("dscr", t.description); return f; };
    await Promise.all([runConfirmTransaction(fd(), deps), runConfirmTransaction(fd(), deps)]);
    const exps = ok(await db.from("tblexpenses").select("*").eq("expbankaccount", ACCT).eq("expdscr", t.description));
    assert.equal(exps.length, 1, `${t.description}: ${urls.join(" ")}`);
    const e = exps[0];
    assert.deepEqual([e.expclearedbank, e.expdatecleared, e.expbankaccount, e.expdate], [true, t.postedon, ACCT, t.postedon], t.description);
    const linked = ok(await db.from("bank_transactions").select("expid").eq("id", t.id).single());
    assert.equal(linked.expid, e.expid);
    assert.deepEqual(urls.map((u) => new URL(u, "http://x").searchParams.has("cleared")).sort(), [false, true], urls.join(" "));
  }
});
