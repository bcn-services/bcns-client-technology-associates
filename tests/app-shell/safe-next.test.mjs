import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../../lib/auth/safe-next.ts";

test("off-site or malformed next falls back to /", () => {
  for (const bad of [
    "https://example.com", "http://x", "//example.com", "/\\example.com", "\\\\x",
    "/\t/example.com", "/\n/x", "javascript:alert(1)", "cases", "", undefined, null, ["/a"],
  ]) {
    assert.equal(safeNext(bad), "/", JSON.stringify(bad));
  }
});

test("same-origin paths pass through unchanged", () => {
  for (const ok of ["/", "/foo", "/cases?a=1", "/cases/90001#x", "/a//b"]) {
    assert.equal(safeNext(ok), ok);
  }
});
