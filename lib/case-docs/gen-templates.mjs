// Regenerates lib/case-docs/templates.ts from lib/case-docs/templates/*.dotx. Run after swapping a template file:
//   node lib/case-docs/gen-templates.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = new URL("./templates/", import.meta.url);
const names = readdirSync(dir).filter((f) => f.endsWith(".dotx")).sort().map((f) => f.slice(0, -5));

writeFileSync(
  new URL("./templates.ts", import.meta.url),
  `/**
 * The legacy case-document templates (lib/case-docs/templates/*.dotx) as base64, so they ship inside the server bundle —
 * the standalone build copies only traced files, and a runtime fs read of a .dotx would not be traced.
 * GENERATED — do not edit. tests/case-docs/fill.test.mjs fails if this drifts from the .dotx files. Regenerate with:
 *   node lib/case-docs/gen-templates.mjs
 */
export type TemplateName = ${names.map((n) => JSON.stringify(n)).join(" | ")};

export const TEMPLATE_DOTX: Readonly<Record<TemplateName, string>> = {
${names.map((n) => `  ${n}: "${readFileSync(new URL(`${n}.dotx`, dir)).toString("base64")}",`).join("\n")}
};
`,
);
