// Renders the `/reports` server component in a plain node test.
//
// tsx compiles `app/reports/page.tsx` to CJS here, so the two runtime seams and the stylesheet import are
// intercepted at the CJS resolver rather than with ESM loader hooks — that keeps the gate command
// (`npx tsx --test tests/docs-reports/*.test.mjs`) working with no extra --import flag.
import Module from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import session from "./stub-session.cjs";
import dbclient from "./stub-dbclient.cjs";

globalThis.React = React; // tsconfig jsx is "preserve"; tsx emits classic React.createElement calls.

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const STUBS = { "@/lib/auth/session": here("./stub-session.cjs"), "@/lib/db/client": here("./stub-dbclient.cjs") };
Module._extensions[".css"] = (m) => { m.exports = {}; };
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return STUBS[request] ?? realResolve.call(this, request, ...rest);
};

const mod = await import("../../app/reports/page.tsx");
const ns = mod.default?.default ? mod.default : mod;
export const ReportsPage = ns.default;
export const pageModule = ns;
export { session, dbclient };

/** Renders the page for one query string against `db` and hands back the markup. */
export async function render(db, searchParams) {
  dbclient.state.db = db;
  return renderToStaticMarkup(await ReportsPage({ searchParams }));
}

/** The single `report-results` panel's inner markup, and a hard failure if there is not exactly one. */
export function panel(markup) {
  const opens = markup.match(/data-testid="report-results"/g) ?? [];
  if (opens.length !== 1) throw new Error(`expected exactly 1 report-results panel, found ${opens.length}`);
  const from = markup.indexOf('data-testid="report-results"');
  return markup.slice(markup.indexOf(">", from) + 1, markup.lastIndexOf("</section>"));
}

/** Every rendered text node, decoded — what a human actually sees in the panel. */
export function texts(markup) {
  return [...markup.matchAll(/>([^<>]*)</g)]
    .map((m) => m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim())
    .filter((s) => s.length > 0);
}

const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/**
 * The cells of one table section, positionally: `[[cell, cell, ...], ...]`. Positional, because a
 * set-shaped assertion lets the totals row act as an oracle for the body rows and hide a swap between them.
 */
export function tableRows(markup, section) {
  const block = markup.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`));
  if (!block) throw new Error(`no <${section}> in markup`);
  return [...block[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*?(?:\/>|>([\s\S]*?)<\/t[dh]>)/g)].map((c) => decode(c[1] ?? "")),
  );
}
