/**
 * The matcher decides which requests the auth gate ever SEES. A path the
 * matcher excludes bypasses middleware.ts entirely — the app's only auth
 * boundary — so the exclusion set is itself a security surface.
 *
 * Dependency-free on purpose: reads the pattern out of middleware.ts as text
 * and runs it, so it can be executed with plain `node --test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "middleware.ts"), "utf8");

// The single string inside config.matcher's array.
const pattern = src.match(/matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*"((?:[^"\\]|\\.)*)"/)[1];
const matcher = new RegExp("^" + pattern.replace(/\\\\/g, "\\") + "$");
const seenByGate = (path) => matcher.test(path);

test("real app paths reach the gate", () => {
  for (const p of ["/", "/cases", "/cases/90001", "/cases?tab=open".split("?")[0], "/login", "/api/health"]) {
    assert.equal(seenByGate(p), true, p);
  }
});

test("only Next internals and true static assets are excluded", () => {
  for (const p of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico"]) {
    assert.equal(seenByGate(p), false, p);
  }
});

test("a dynamic route segment ending in an asset extension must still reach the gate", () => {
  // /cases/[id] with id="90001.js" is a real page render, not a static file.
  for (const p of ["/cases/90001.js", "/cases/90001.css", "/cases/90001.map", "/cases/90001.png", "/cases/90001.woff2"]) {
    assert.equal(seenByGate(p), true, `${p} bypasses the auth gate`);
  }
});
