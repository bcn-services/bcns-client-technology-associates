// Item 3 (unit): GET /cases/[id]/documents/[doc] with the session and db seams stubbed at the CJS resolver (the
// docs-reports stubs, imported not edited) — the only way to see the route's own requireSession, which middleware
// hides over HTTP — plus source checks on the route and the case page. Synthetic data only.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import session from "../docs-reports/stub-session.cjs";
import dbclient from "../docs-reports/stub-dbclient.cjs";
import { CASE_DOCS } from "../../lib/case-docs/docs.ts";
import { firmToday } from "../../lib/cases/presets.ts";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const STUBS = { "@/lib/auth/session": here("../docs-reports/stub-session.cjs"), "@/lib/db/client": here("../docs-reports/stub-dbclient.cjs") };
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return STUBS[request] ?? realResolve.call(this, request, ...rest); };
const mod = await import("../../app/cases/[id]/documents/[doc]/route.ts");
const GET = (mod.default?.GET ? mod.default : mod).GET;

const ROUTE_SRC = readFileSync(here("../../app/cases/[id]/documents/[doc]/route.ts"), "utf8");
const PAGE_SRC = readFileSync(here("../../app/cases/[id]/page.tsx"), "utf8");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ROW = { caseid: 99001, casetitle: "Example v. Sample", casecaption: "Index No. 000/0000", caseatty: null };

let reads = 0;
const rowDb = (result) => ({ from: () => { reads++; const q = { select: () => q, eq: () => q, maybeSingle: async () => result }; return q; } });
function setup({ result = { data: ROW, error: null }, redirect = false } = {}) {
  dbclient.state.db = rowDb(result);
  dbclient.state.calls = 0;
  session.state.calls = 0;
  session.state.redirect = redirect;
  reads = 0;
}
const get = (id, doc) => GET(new Request(`http://localhost:3150/cases/${id}/documents/${doc}`), { params: { id: String(id), doc } });

test("anonymous → the login redirect is thrown before any db work, for every kind", async () => {
  for (const d of CASE_DOCS) {
    setup({ redirect: true });
    const e = await get(99001, d.slug).then((r) => r, (err) => err);
    assert.ok(e instanceof Error, `${d.slug}: a Response was returned to an anonymous caller`);
    assert.equal(e.digest, "NEXT_REDIRECT;/login");
    assert.equal(dbclient.state.calls + reads, 0);
  }
});

test("signed in → 200 docx attachment named for the case, filled with the case's values", async () => {
  for (const d of CASE_DOCS) {
    setup();
    const res = await get(99001, d.slug);
    assert.equal(session.state.calls, 1);
    assert.equal(res.status, 200, d.slug);
    assert.equal(res.headers.get("content-type"), DOCX);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const name = d.fileName(99001);
    assert.equal(res.headers.get("content-disposition"), `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    const xml = await (await JSZip.loadAsync(await res.arrayBuffer())).file("word/document.xml").async("string");
    if (d.slug !== "inspection-plan") assert.ok(xml.includes("Example v. Sample"), `${d.slug}: title not filled`);
  }
});

test("unknown kind, non-numeric id, missing case → 404 plain text; session checked first", async () => {
  for (const [id, doc, result] of [[99001, "invoice"], ["abc", "memo"], ["1e3", "memo"], [99002, "memo", { data: null, error: null }]]) {
    setup({ result });
    const res = await get(id, doc);
    assert.equal(session.state.calls, 1);
    assert.equal(res.status, 404, `${id}/${doc}`);
    assert.match(res.headers.get("content-type"), /^text\/plain/);
    assert.equal(res.headers.get("content-disposition"), null);
    assert.ok((await res.text()).length > 0);
  }
});

test("db failure → 503 plain text, never document bytes", async () => {
  setup({ result: { data: null, error: { message: "boom" } } });
  const orig = console.error; console.error = () => {};
  try {
    const res = await get(99001, "memo");
    assert.equal(res.status, 503);
    assert.match(res.headers.get("content-type"), /^text\/plain/);
    assert.equal(res.headers.get("content-disposition"), null);
  } finally { console.error = orig; }
});

test("CTA Report: the CREATEDATE fields and core.xml carry the request's date, not the template's 2023", async () => {
  setup();
  const t0 = new Date();
  const zip = await JSZip.loadAsync(await (await get(99001, "cta-report")).arrayBuffer());
  const t1 = new Date();
  const text = (await zip.file("word/document.xml").async("string")).replace(/<w:instrText\b[^>]*>[^<]*<\/w:instrText>/g, "").replace(/<[^>]+>/g, "");
  const years = new Set([t0, t1].map((d) => firmToday(d).slice(0, 4)));
  assert.ok([...years].some((y) => text.includes(`-${y}`)), "CTA REPORT #<id>-<firm year>");
  assert.ok(!text.includes("2023"));
  const created = /<dcterms:created\b[^>]*>([^<]*)</.exec(await zip.file("docProps/core.xml").async("string"))[1];
  assert.ok(Math.abs(Date.parse(created) - t0.getTime()) < 120_000, `created ${created} is now`);
});

test("source: one `now` feeds loadCaseDocValues and fillTemplate, with the firm's date from firmToday(now)", () => {
  assert.match(ROUTE_SRC, /const now = new Date\(\);/);
  assert.match(ROUTE_SRC, /loadCaseDocValues\(.*, now\);/);
  assert.match(ROUTE_SRC, /fillTemplate\([^;]*, values, now, firmToday\(now\)\)/);
  assert.equal(ROUTE_SRC.match(/new Date\(/g).length, 1);
});

test("source: GET's first statement is `await requireSession()`", () => {
  assert.match(ROUTE_SRC, /export async function GET\([^)]*\)[^{]*\{\s*await requireSession\(\);/);
});

test("source: case page renders the four links from CASE_DOCS as plain <a> (no prefetch), beside Rolodex card", () => {
  assert.match(PAGE_SRC, /import \{ CASE_DOCS \} from "@\/lib\/case-docs\/docs";/);
  assert.doesNotMatch(PAGE_SRC, /case-docs\/(fill|templates)/, "page must not pull jszip or the template bytes");
  const i = PAGE_SRC.indexOf("Rolodex card</Link>");
  const line = PAGE_SRC.slice(i).split("\n")[1];
  assert.match(line, /CASE_DOCS\.map\(\(d\) => <a key=\{d\.slug\} href=\{`\/cases\/\$\{id\}\/documents\/\$\{d\.slug\}`\} className="underline">\{d\.label\}<\/a>\)/);
  assert.equal(CASE_DOCS.length, 4);
});
