// Renders the `/dashboard` server component in a plain node test.
// Importing ./render.mjs first installs the CJS stubs for `@/lib/auth/session` and `@/lib/db/client`
// (and the .css extension hook) process-wide — this module only reuses them.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { session, dbclient, texts, tableRows } from "./render.mjs";

const mod = await import("../../app/dashboard/page.tsx");
const ns = mod.default?.default ? mod.default : mod;
export const DashboardPage = ns.default;
export const pageModule = ns;
export { session, dbclient, texts, tableRows };
export { React };

export async function renderDashboard(db) {
  dbclient.state.db = db;
  return renderToStaticMarkup(await DashboardPage({}));
}
