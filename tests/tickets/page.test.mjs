// Renders app/tickets/page.tsx in plain node (stubs for session + db client come from the docs-reports harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { session, dbclient } from "../docs-reports/render.mjs";

const mod = await import("../../app/tickets/page.tsx");
const Page = (mod.default?.default ? mod.default : mod).default;

const T = (id, ticketdate, status, description) => ({ id, ticketdate, description, status, createdat: "x" });
const ROWS = [T(1, "2026-10-01", "Closed", "old one"), T(2, "2026-10-05", "Open", "new one")];
const render = async (searchParams = {}) => {
  dbclient.state.db = { from: () => ({ select: () => Promise.resolve({ data: ROWS, error: null }) }) };
  return renderToStaticMarkup(await Page({ searchParams }));
};
const order = (html) => [...html.matchAll(/(old|new) one/g)].map((m) => m[1]);

test("default render: Open row first, status header links to dir=desc, Close/Reopen buttons per row, no extra links", async () => {
  const before = session.state.calls;
  const html = await render();
  assert.equal(session.state.calls, before + 1, "session check must run on every render");
  assert.deepEqual(order(html), ["new", "old"]);
  assert.match(html, /<a href="\/tickets\?sort=status&amp;dir=desc"[^>]*>Status/);
  assert.equal((html.match(/<a /g) ?? []).length, 1, "the sort header is the only link");
  assert.match(html, /<button[^>]*>Close<\/button>/);
  assert.match(html, /<button[^>]*>Reopen<\/button>/);
  assert.match(html, /<input[^>]*type="date"/);
});
test("?sort=status&dir=desc puts Closed first and flips the header link; junk params fall back to default", async () => {
  const desc = await render({ sort: "status", dir: "desc" });
  assert.deepEqual(order(desc), ["old", "new"]);
  assert.match(desc, /dir=asc/);
  assert.deepEqual(order(await render({ sort: "status", dir: "sideways" })), ["new", "old"]);
  assert.deepEqual(order(await render({ sort: "createdat", dir: "desc" })), ["new", "old"]);
});
test("?error= shows its message; unknown code shows the generic one", async () => {
  assert.match(await render({ error: "date" }), /role="alert"[^>]*>Enter a valid date\./);
  assert.match(await render({ error: "zzz" }), /Save failed; nothing was changed\./);
});
test("no client JS: neither tickets file is a client component", () => {
  for (const f of ["../../app/tickets/page.tsx", "../../app/tickets/actions.ts"]) {
    assert.ok(!/["']use client["']/.test(readFileSync(new URL(f, import.meta.url), "utf8")), f);
  }
});
