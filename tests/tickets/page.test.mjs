// Renders app/tickets/page.tsx in plain node (stubs for session + db client come from the docs-reports harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { session, dbclient } from "../docs-reports/render.mjs";
import { memDb } from "./fakedb.mjs";
import { createRequire } from "node:module";

// react-dom 18.3 has no useFormStatus outside Next's bundled canary (same shim as tests/cases/convert.test.mjs).
const formStatus = { pending: false };
createRequire(import.meta.url)("react-dom").useFormStatus = () => formStatus;
// Same for React.useOptimistic (app/tickets/optimistic-status.tsx): idle here, the flip itself is tested in optimistic.test.mjs.
createRequire(import.meta.url)("react").useOptimistic = (state) => [state, () => {}];

const mod = await import("../../app/tickets/page.tsx");
const Page = (mod.default?.default ? mod.default : mod).default;

const T = (id, ticketdate, status, description) => ({ id, ticketdate, description, status, createdat: "x" });
const ROWS = [T(1, "2026-10-01", "Closed", "old one"), T(2, "2026-10-05", "Open", "new one"), T(3, "2026-09-20", "In review", "review one")];
const MSGS = [
  { id: 1, ticketid: 3, author: "email", body: "looks fixed to me", createdat: "2026-10-20T10:00:00Z" },
  { id: 2, ticketid: 1, author: "kris@example.test", body: "closed it", createdat: "2026-10-02T10:00:00Z" },
];
const render = async (searchParams = {}) => {
  dbclient.state.db = memDb({ tickets: ROWS, ticket_messages: MSGS });
  return renderToStaticMarkup(await Page({ searchParams }));
};
const order = (html) => [...html.matchAll(/(old|new|review) one/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
/** The <tr> for one ticket, by its description text. */
const row = (html, text) => html.split("<tr").find((r) => r.includes(`>${text}</div>`)) ?? assert.fail(`no row for ${text}`);

test("default render: In review, Open, Closed order; status header links to dir=desc; no extra links", async () => {
  const before = session.state.calls;
  const html = await render();
  assert.equal(session.state.calls, before + 1, "session check must run on every render");
  assert.deepEqual(order(html), ["review", "new", "old"]);
  assert.match(html, /<a href="\/tickets\?sort=status&amp;dir=desc"[^>]*>Status/);
  assert.equal((html.match(/<a /g) ?? []).length, 1, "the sort header is the only link");
  assert.match(html, /<input[^>]*type="date"/);
});
test("In review row: blue badge, Nate's reply shown, optional response box, both Close and Reopen, Edit", async () => {
  const r = row(await render(), "review one");
  assert.match(r, /bg-blue-100[^>]*>In review</);
  assert.match(r, /Reply by email/);
  assert.match(r, /looks fixed to me/);
  assert.match(r, /<textarea[^>]*name="response"/);
  assert.match(r, /<button[^>]*>Close<\/button>/);
  assert.match(r, /<button[^>]*>Reopen<\/button>/);
  assert.match(r, /<summary[^>]*>Edit<\/summary>/);
});
test("Open row: Close and Edit, no Reopen. Closed row: Reopen only, no Edit, staff response shown by author", async () => {
  const html = await render();
  const open = row(html, "new one");
  assert.match(open, /<button[^>]*>Close<\/button>/);
  assert.doesNotMatch(open, />Reopen</);
  assert.match(open, /<summary[^>]*>Edit<\/summary>/);
  const closed = row(html, "old one");
  assert.match(closed, /<button[^>]*>Reopen<\/button>/);
  assert.doesNotMatch(closed, />Close</);
  assert.doesNotMatch(closed, /Edit/);
  assert.match(closed, /kris@example\.test/);
  assert.match(closed, /closed it/);
});
test("?sort=status&dir=desc puts Closed first and flips the header link; junk params fall back to default", async () => {
  const desc = await render({ sort: "status", dir: "desc" });
  assert.deepEqual(order(desc), ["old", "new", "review"]);
  assert.match(desc, /dir=asc/);
  assert.deepEqual(order(await render({ sort: "status", dir: "sideways" })), ["review", "new", "old"]);
  assert.deepEqual(order(await render({ sort: "createdat", dir: "desc" })), ["review", "new", "old"]);
});
test("?error= shows its message; unknown code shows the generic one", async () => {
  assert.match(await render({ error: "date" }), /role="alert"[^>]*>Enter a valid date\./);
  assert.match(await render({ error: "zzz" }), /Save failed; nothing was changed\./);
});
test("page and actions stay server-side (the only client components are submit-button.tsx and optimistic-status.tsx)", () => {
  const dir = new URL("../../app/tickets/", import.meta.url);
  const client = readdirSync(dir).filter((f) => /["']use client["']/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(client.sort(), ["optimistic-status.tsx", "submit-button.tsx"]);
});

test("every ticket button is disabled while its form's action runs, and enabled otherwise", async () => {
  assert.doesNotMatch(await render(), /<button[^>]* disabled=""/);
  formStatus.pending = true;
  try {
    const html = await render();
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    assert.ok(buttons.length >= 6, "Add, Save x2, Close x2, Reopen x2");
    for (const b of buttons) assert.match(b, / disabled=""/);
    assert.doesNotMatch(html, /Saving…/, "only the clicked button says Saving…, and none was clicked");
  } finally {
    formStatus.pending = false;
  }
});
