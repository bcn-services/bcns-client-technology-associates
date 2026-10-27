// lib/documents/legacy.ts — mapping a bare NAS name to the nightly copy, the traversal guard, and the streamed response.
// Pure fs against tests/docs-reports/fixtures (synthetic files); no DB, no session, no env.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_FOLDERS, legacyFileResponse, resolveLegacyFile } from "../../lib/documents/legacy.ts";

const FIX = fileURLToPath(new URL("./fixtures", import.meta.url));
const ROOT = path.join(FIX, "legacy-docs");
// The NAS is case-insensitive and so can be a dev laptop's disk: compare the folder and lower-cased base name.
const where = (abs) => [path.basename(path.dirname(abs)), path.basename(abs).toLowerCase()];

test("the three NAS folders are pinned", () => {
  assert.deepEqual(LEGACY_FOLDERS, { scan: "ScannedDocs", bill: "Bills", sa: "ServAuth" });
});

test("a scan name maps as-is into ScannedDocs; a bill/SA base name finds its Word file", async () => {
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "scan", "img-120124111506.pdf")), ["ScannedDocs", "img-120124111506.pdf"]);
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "bill", "Bill2670 Huske 2023 08 11-0")), ["Bills", "bill2670 huske 2023 08 11-0.doc"]);
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "sa", "SA2110 Schulthess 2015 03 06-0")), ["ServAuth", "sa2110 schulthess 2015 03 06-0.docx"]);
});

test("extension fallback: a pdf export beats .doc; a name with its extension already is found as-is", async () => {
  assert.equal(where(await resolveLegacyFile(ROOT, "bill", "BillBoth"))[1], "billboth.pdf");
  assert.equal(where(await resolveLegacyFile(ROOT, "bill", "BillBoth.doc"))[1], "billboth.doc");
  // a scan is NOT given extensions: the stored name is the whole name
  assert.equal(await resolveLegacyFile(ROOT, "scan", "img-120124111506"), null);
});

test("matching ignores case, and finds files in sub-folders", async () => {
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "scan", "MIXED-case scan.pdf")), ["ScannedDocs", "mixed-case scan.pdf"]);
  assert.equal(where(await resolveLegacyFile(ROOT, "bill", "BILL2670 HUSKE 2023 08 11-0"))[1], "bill2670 huske 2023 08 11-0.doc");
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "scan", "nested.PNG")), ["2019", "nested.png"]);
});

test("a '..' INSIDE a name is allowed; non-ASCII names resolve", async () => {
  assert.equal(where(await resolveLegacyFile(ROOT, "scan", "2675_FeeSched..pdf"))[1], "2675_feesched..pdf");
  assert.equal(where(await resolveLegacyFile(ROOT, "scan", "FJC \u2013 CourtListener.pdf"))[1], "fjc \u2013 courtlistener.pdf");
});

test("traversal and absolute names are refused, even when the target exists", async () => {
  // legacy-docs/outside/secret.txt is a real file one level up from every folder: only the name guard stands between it and the caller
  const secret = path.join(ROOT, "outside", "secret.txt");
  assert.equal(readFileSync(secret, "utf8").length > 0, true, "the fixture the guard must protect exists");
  const bad = ["../outside/secret.txt", "../../legacy-docs/outside/secret.txt", "/etc/passwd", secret, "a/b", "..\\x", "..", ".", "", "a\0b", "C:\\Windows\\win.ini", "C:x", "ScannedDocs/img-120124111506.pdf"];
  for (const kind of ["scan", "bill", "sa"]) {
    for (const name of bad) assert.equal(await resolveLegacyFile(ROOT, kind, name), null, `${kind} ${JSON.stringify(name)} was resolved`);
  }
});

test("a symlink inside the copy cannot lead out of the legacy root", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "legacy-docs-"));
  try {
    const root = path.join(tmp, "root");
    mkdirSync(path.join(root, "ScannedDocs"), { recursive: true });
    mkdirSync(path.join(tmp, "elsewhere"));
    writeFileSync(path.join(tmp, "elsewhere", "secret.txt"), "not for you\n");
    symlinkSync(path.join(tmp, "elsewhere", "secret.txt"), path.join(root, "ScannedDocs", "link.txt"));
    symlinkSync(path.join(tmp, "elsewhere"), path.join(root, "ScannedDocs", "dir"));
    writeFileSync(path.join(root, "ScannedDocs", "real.txt"), "fine\n");
    symlinkSync(path.join(root, "ScannedDocs", "real.txt"), path.join(root, "ScannedDocs", "inside.txt"));
    assert.equal(await resolveLegacyFile(root, "scan", "link.txt"), null);
    assert.equal(await resolveLegacyFile(root, "scan", "LINK.txt"), null, "the case-insensitive scan is contained too");
    assert.equal(await resolveLegacyFile(root, "scan", "secret.txt"), null, "a file reached through a symlinked folder is contained too");
    assert.equal(path.basename(await resolveLegacyFile(root, "scan", "inside.txt")), "real.txt", "a symlink that stays inside the root still works");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("missing file, missing folder, missing root, and a directory are all null", async () => {
  assert.equal(await resolveLegacyFile(ROOT, "scan", "nope.pdf"), null);
  assert.equal(await resolveLegacyFile(ROOT, "bill", "Bill9999 Nobody"), null);
  assert.equal(await resolveLegacyFile(path.join(FIX, "no-such-root"), "scan", "img-120124111506.pdf"), null);
  assert.equal(await resolveLegacyFile(path.join(ROOT, "outside"), "scan", "secret.txt"), null, "no ScannedDocs folder under the root");
  assert.equal(await resolveLegacyFile(ROOT, "scan", "2019"), null, "a folder is not a file");
});

test("legacyFileResponse: a pdf streams inline with the hardening headers and the exact bytes", async () => {
  const abs = await resolveLegacyFile(ROOT, "scan", "img-120124111506.pdf");
  const res = await legacyFileResponse(abs);
  const bytes = readFileSync(abs);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(res.headers.get("content-disposition"), 'inline; filename="img-120124111506.pdf"');
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-length"), String(bytes.length));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test("legacyFileResponse: Word files download; images are inline; a non-ASCII name gets an RFC 5987 filename*", async () => {
  const doc = await legacyFileResponse(await resolveLegacyFile(ROOT, "bill", "Bill2670 Huske 2023 08 11-0"));
  assert.equal(doc.headers.get("content-type"), "application/msword");
  assert.match(doc.headers.get("content-disposition"), /^attachment; filename="Bill2670 Huske 2023 08 11-0\.doc"$/);
  await doc.arrayBuffer();
  const docx = await legacyFileResponse(await resolveLegacyFile(ROOT, "sa", "SA2110 Schulthess 2015 03 06-0"));
  assert.equal(docx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(docx.headers.get("content-disposition"), /^attachment;/);
  await docx.arrayBuffer();
  const png = await legacyFileResponse(await resolveLegacyFile(ROOT, "scan", "Nested.png"));
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.match(png.headers.get("content-disposition"), /^inline;/);
  await png.arrayBuffer();
  const en = await legacyFileResponse(await resolveLegacyFile(ROOT, "scan", "FJC \u2013 CourtListener.pdf"));
  assert.equal(en.headers.get("content-disposition"), `inline; filename="FJC _ CourtListener.pdf"; filename*=UTF-8''FJC%20%E2%80%93%20CourtListener.pdf`);
  await en.arrayBuffer();
});
