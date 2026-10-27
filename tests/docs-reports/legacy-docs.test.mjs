// lib/documents/legacy.ts — mapping a bare NAS name to the nightly copy, the traversal guard, and the streamed response.
// Pure fs against tests/docs-reports/fixtures (synthetic files); no DB, no session, no env.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
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
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "bill", "Bill9001 Doe 2023 08 11-0")), ["Bills", "bill9001 doe 2023 08 11-0.doc"]);
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "sa", "SA9002 Roe 2015 03 06-0")), ["ServAuth", "sa9002 roe 2015 03 06-0.docx"]);
});

test("extension fallback: a pdf export beats .doc; a name with its extension already is found as-is", async () => {
  assert.equal(where(await resolveLegacyFile(ROOT, "bill", "BillBoth"))[1], "billboth.pdf");
  assert.equal(where(await resolveLegacyFile(ROOT, "bill", "BillBoth.doc"))[1], "billboth.doc");
  // a scan is NOT given extensions: the stored name is the whole name
  assert.equal(await resolveLegacyFile(ROOT, "scan", "img-120124111506"), null);
});

test("matching ignores case, and finds files in sub-folders", async () => {
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "scan", "MIXED-case scan.pdf")), ["ScannedDocs", "mixed-case scan.pdf"]);
  assert.equal(where(await resolveLegacyFile(ROOT, "bill", "BILL9001 DOE 2023 08 11-0"))[1], "bill9001 doe 2023 08 11-0.doc");
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "scan", "nested.PNG")), ["2019", "nested.png"]);
});

test("a '..' INSIDE a name is allowed; non-ASCII names resolve", async () => {
  assert.equal(where(await resolveLegacyFile(ROOT, "scan", "2675_FeeSched..pdf"))[1], "2675_feesched..pdf");
  assert.equal(where(await resolveLegacyFile(ROOT, "scan", "Example \u2013 Docket Listing.pdf"))[1], "example \u2013 docket listing.pdf");
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
  const doc = await legacyFileResponse(await resolveLegacyFile(ROOT, "bill", "Bill9001 Doe 2023 08 11-0"));
  assert.equal(doc.headers.get("content-type"), "application/msword");
  assert.match(doc.headers.get("content-disposition"), /^attachment; filename="Bill9001 Doe 2023 08 11-0\.doc"$/);
  await doc.arrayBuffer();
  const docx = await legacyFileResponse(await resolveLegacyFile(ROOT, "sa", "SA9002 Roe 2015 03 06-0"));
  assert.equal(docx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(docx.headers.get("content-disposition"), /^attachment;/);
  await docx.arrayBuffer();
  const png = await legacyFileResponse(await resolveLegacyFile(ROOT, "scan", "Nested.png"));
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.match(png.headers.get("content-disposition"), /^inline;/);
  await png.arrayBuffer();
  const en = await legacyFileResponse(await resolveLegacyFile(ROOT, "scan", "Example \u2013 Docket Listing.pdf"));
  assert.equal(en.headers.get("content-disposition"), `inline; filename="Example _ Docket Listing.pdf"; filename*=UTF-8''Example%20%E2%80%93%20Docket%20Listing.pdf`);
  await en.arrayBuffer();
});

// A scratch legacy root under the OS tmp dir; the callback gets its path and it is removed afterwards.
async function withTmpRoot(fn) {
  const tmp = mkdtempSync(path.join(tmpdir(), "legacy-docs-"));
  try {
    mkdirSync(path.join(tmp, "ScannedDocs", "2020"), { recursive: true });
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("two different files with one base name in different sub-folders are ambiguous: null, and the warning has no file name", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await resolveLegacyFile(ROOT, "scan", "Twin Scan.pdf"), null);
  assert.equal(await resolveLegacyFile(ROOT, "scan", "TWIN SCAN.PDF"), null, "the case-insensitive match is ambiguous too");
  assert.equal(warn.mock.callCount(), 2);
  assert.equal(warn.mock.calls[0].arguments.join(" "), "legacy file ambiguous: kind=scan matches=2");
  // a base name with ONE match in a sub-folder still resolves, quietly
  assert.deepEqual(where(await resolveLegacyFile(ROOT, "scan", "nested.png")), ["2019", "nested.png"]);
  assert.equal(warn.mock.callCount(), 2);
});

test("a top-level exact name wins over a same-named file in a sub-folder (no ambiguity)", async () => {
  await withTmpRoot(async (tmp) => {
    writeFileSync(path.join(tmp, "ScannedDocs", "Dup.pdf"), "top\n");
    writeFileSync(path.join(tmp, "ScannedDocs", "2020", "Dup.pdf"), "nested\n");
    assert.equal(readFileSync(await resolveLegacyFile(tmp, "scan", "Dup.pdf"), "utf8"), "top\n");
  });
});

test("Unicode normalization: a decomposed (NFD) name on disk is found by its composed (NFC) name, and the reverse", async (t) => {
  await withTmpRoot(async (tmp) => {
    // In a sub-folder, so the exact top-level probe misses on any file system and the name index decides.
    const dir = path.join(tmp, "ScannedDocs", "2020");
    const nfd = "Cafe\u0301 Menu.pdf";
    const nfc = "Caf\u00e9 Bar.pdf";
    writeFileSync(path.join(dir, nfd), "nfd on disk\n");
    writeFileSync(path.join(dir, nfc), "nfc on disk\n");
    if (!readdirSync(dir).includes(nfd)) return t.skip("this file system does not keep the decomposed name");
    assert.equal(readFileSync(await resolveLegacyFile(tmp, "scan", "Caf\u00e9 Menu.pdf"), "utf8"), "nfd on disk\n");
    assert.equal(readFileSync(await resolveLegacyFile(tmp, "scan", "Cafe\u0301 Bar.pdf"), "utf8"), "nfc on disk\n");
  });
});

const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

test("an unreadable file is a fault (throws), not a resolved path; the response says not-found for a vanished file and throws otherwise", { skip: asRoot && "root reads everything" }, async () => {
  await withTmpRoot(async (tmp) => {
    const file = path.join(tmp, "ScannedDocs", "locked.pdf");
    writeFileSync(file, "x\n");
    chmodSync(file, 0o000);
    await assert.rejects(resolveLegacyFile(tmp, "scan", "locked.pdf"), { code: "EACCES" });
    await assert.rejects(legacyFileResponse(file), { code: "EACCES" });
    chmodSync(file, 0o644);
    assert.equal(await resolveLegacyFile(tmp, "scan", "locked.pdf"), await realpath(file));
    rmSync(file);
    assert.equal(await legacyFileResponse(file), null, "a file that vanished after it was resolved is null, so the caller can answer 404");
  });
});
