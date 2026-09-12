/** QA attempt 2 unit checks: exact grand total, and the panel's read-failure note (rows null). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { serviceAuthGrandTotal } from "../../lib/cases/service-auths.ts";

globalThis.React = React; // tsx compiles the .tsx with the classic JSX runtime
// useFormStatus ships only in Next's bundled React canary; stable react-dom 18.3.1 lacks it. Stub it idle.
createRequire(import.meta.url)("react-dom").useFormStatus ??= () => ({ pending: false });

test("grand total sums per-status hours exactly at 3 decimals (float traps pinned)", () => {
  const totals = [
    { status: "Approved", count: 3, hours: "0.100" },
    { status: "Awaiting Approval", count: 2, hours: "0.200" },
    { status: "Declined", count: 1, hours: "1.235" },
    { status: "Modified", count: 4, hours: "2.005" },
    { status: "(blank)", count: 1, hours: "999999.999" },
  ];
  // hand sum: 0.100 + 0.200 + 1.235 + 2.005 + 999999.999 = 1000003.539
  assert.deepEqual(serviceAuthGrandTotal(totals), { status: "All", count: 11, hours: "1000003.539" });
  assert.deepEqual(serviceAuthGrandTotal([]), { status: "All", count: 0, hours: "0.000" });
});

test("panel with rows=null shows the generic note, no raw error, add form still rendered", async () => {
  const { ServiceAuthsPanel } = await import("../../app/cases/[id]/service-auths.tsx");
  const html = renderToStaticMarkup(React.createElement(ServiceAuthsPanel, { caseId: 90001, rows: null, today: "2026-09-11", t: "initial" }));
  assert.match(html, /Couldn(&#x27;|')t load service authorizations\. Try again\./);
  assert.match(html, /data-testid="sa-add"/);
  assert.doesNotMatch(html, /No service authorizations\./);
  assert.doesNotMatch(html, /tblsrvauth|error:|stack/i);
});
