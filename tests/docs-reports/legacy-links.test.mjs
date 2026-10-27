// The links to legacy NAS files: a legacy row only becomes a link once the page says the NAS copy exists
// (case panel: LEGACY_DOCS_DIR set; bill and SA: the file resolved). Pure renders, no env, no fs.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
createRequire(import.meta.url)("react-dom").useFormStatus ??= () => ({ pending: false });
// The panel's upload form is a client component; swap it at the CJS resolver like documents.test.mjs does.
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "./upload-form" ? fileURLToPath(new URL("./stub-upload-form.cjs", import.meta.url)) : realResolve.call(this, request, ...rest);
};

const panel = await import("../../app/documents/case-panel.tsx");
const { CaseDocumentsPanelView } = panel.default?.CaseDocumentsPanelView ? panel.default : panel;
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { ServiceAuthsPanel } = await import("../../app/cases/[id]/service-auths.tsx");

const DOCS = [{ id: 7, caseid: 101, dateadded: "2026-01-02", type: null, description: null, filename: "img-121210115543.pdf" }];

test("case panel: a legacy row links to the download route under the case scope once the NAS copy is configured; otherwise the bare name", () => {
  const on = renderToStaticMarkup(CaseDocumentsPanelView({ caseId: 101, docs: DOCS, storageReady: true, legacyReady: true }));
  assert.match(on, /<a [^>]*href="\/documents\/7\/download\?case=101"[^>]*>img-121210115543\.pdf<\/a>/);
  assert.doesNotMatch(on, /Stored on the office NAS/);
  const off = renderToStaticMarkup(CaseDocumentsPanelView({ caseId: 101, docs: DOCS, storageReady: true }));
  assert.doesNotMatch(off, /\/documents\/7\/download/);
  assert.match(off, /Stored on the office NAS/);
});

const BILL = {
  billid: 7, billcaseid: 55, billdate: "2019-02-01", billhours: 0, billbalance: 120, billreports: null, billfilename: "Bill2670 Huske 2023 08 11-0",
  billnotice: "Paid", billpaiddate: null, billestimate: false, billpriority: null, billcomments: null, billsecondnoticedate: null,
  billfinalnoticedate: null, billtype: null, supersedesbillid: null, billfinalizedat: null, billpdfpath: null,
};
const fileCell = (html) => html.match(/<dt[^>]*>File name<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/)?.[1] ?? html.match(/File name.{0,300}/)?.[0] ?? "MISSING";
const billHtml = (props, bill = BILL) => renderToStaticMarkup(React.createElement(BillView, { data: { bill, casetitle: "X", activity: [], revisedBy: [] }, admin: false, ...props }));

test("bill view: 'File name' links to the bill's pdf route only when the legacy file resolved and there is no stored PDF", () => {
  assert.match(fileCell(billHtml({ legacyFile: true })), /<a [^>]*href="\/bills\/7\/pdf"[^>]*>Bill2670 Huske 2023 08 11-0<\/a>/);
  assert.doesNotMatch(fileCell(billHtml({})), /<a /);
  assert.doesNotMatch(fileCell(billHtml({ legacyFile: false })), /<a /);
  assert.doesNotMatch(fileCell(billHtml({ legacyFile: true }, { ...BILL, billpdfpath: "bills/7/x.pdf" })), /href="\/bills\/7\/pdf"[^>]*>Bill2670/, "an app bill keeps its own PDF link, not a file-name link");
});

const SA_ROWS = [
  { srvauthid: 901, srvauthcaseid: 55, srvauthdate: "2015-03-06", srvauthhours: "1.000", srvauthstatus: "Approved", srvdateapproved: null, srvauthfile: "SA2110 Schulthess 2015 03 06-0", srvadvance: null, srvauthnotes: null },
  { srvauthid: 902, srvauthcaseid: 55, srvauthdate: "2015-03-06", srvauthhours: "1.000", srvauthstatus: "Approved", srvdateapproved: null, srvauthfile: "SA55 Munoz 2026 01 02-3", srvadvance: null, srvauthnotes: null },
];
const saHtml = (legacyOpen) => renderToStaticMarkup(React.createElement(ServiceAuthsPanel, { caseId: 55, rows: SA_ROWS, today: "2026-09-11", t: "initial", legacyOpen }));

test("service auths: 'Open file' appears for a resolved legacy row only; an app-made row keeps its PDF link", () => {
  const on = saHtml(["901"]);
  assert.match(on, /<a [^>]*href="\/cases\/service-auths\/pdf\/901"[^>]*data-testid="sa-legacy-file"[^>]*>Open file<\/a>/);
  assert.equal((on.match(/Open file/g) ?? []).length, 1);
  assert.match(on, /href="\/cases\/service-auths\/pdf\/902"[^>]*data-testid="sa-pdf"/);
  assert.doesNotMatch(saHtml(undefined), /Open file/);
  assert.doesNotMatch(saHtml(["902"]), /Open file/, "an app-made row never gets the legacy link");
});
