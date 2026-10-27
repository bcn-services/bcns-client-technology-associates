/**
 * Legacy NAS files — the scans, bills and service authorizations that live only on the office NAS.
 *
 * A nightly job copies the NAS folders to `$LEGACY_DOCS_DIR/{ScannedDocs,Bills,ServAuth}` on the droplet;
 * this module maps a bare legacy file name (a `tblscanneddocument.filename`, `tblbills.billfilename` or
 * `tblsrvauth.srvauthfile`) to a file under that copy and streams it. Authorization is NOT decided here:
 * every caller authorizes the ROW first (requireSession + the row's own scope), exactly as it does for
 * app-stored files, and only then asks for the bytes.
 */
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

export type LegacyKind = "scan" | "bill" | "sa";

/** The NAS folder each kind is copied into, under the legacy root. */
export const LEGACY_FOLDERS: Record<LegacyKind, string> = { scan: "ScannedDocs", bill: "Bills", sa: "ServAuth" };

/**
 * A bare NAS name: no separators, no NUL, not "." or "..", not absolute or a drive path. A ".." INSIDE a name
 * is fine (real rows: `2675_FeeSched..pdf`) — it is only dangerous as a whole path segment, and a name with no
 * separator is never more than one segment.
 */
const unsafeName = (n: string): boolean =>
  !n || n.includes("\0") || /[\\/]/.test(n) || n === "." || n === ".." || path.isAbsolute(n) || /^[a-zA-Z]:/.test(n);

/** Bills and SAs are stored WITHOUT an extension; the file is a Word `.doc`/`.docx` or a `.pdf` export. PDF first: it opens in the browser. */
const candidates = (kind: LegacyKind, name: string): string[] =>
  kind === "scan" ? [name] : [`${name}.pdf`, `${name}.docx`, `${name}.doc`, name];

const lc = (s: string): string => s.normalize("NFC").toLowerCase();

/** A missing path is an answer ("not here"); anything else (permissions, I/O) is a fault the caller must see. */
const missing = (e: unknown): boolean => ["ENOENT", "ENOTDIR", "ELOOP"].includes((e as NodeJS.ErrnoException)?.code ?? "");

/**
 * `file` resolved through symlinks, or null unless it is a regular file inside `realRoot`.
 * The containment check is on the REAL path, so a symlink in the copy cannot lead out of the legacy root.
 */
async function contained(realRoot: string, file: string): Promise<string | null> {
  try {
    const real = await realpath(file);
    if (!real.startsWith(realRoot + path.sep) || !(await stat(real)).isFile()) return null;
    return real;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/**
 * Absolute path of the legacy file for `name`, or null when the name is unsafe or no such file exists.
 * Exact match first; on a miss, the folder is scanned for the same base name ignoring case (the NAS is
 * case-insensitive, the droplet's disk is not) — that scan also finds files in sub-folders.
 */
export async function resolveLegacyFile(root: string, kind: LegacyKind, name: string): Promise<string | null> {
  if (unsafeName(name)) return null;
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
  const folder = path.join(realRoot, LEGACY_FOLDERS[kind]);
  const wanted = candidates(kind, name);
  for (const c of wanted) {
    const hit = await contained(realRoot, path.join(folder, c));
    if (hit) return hit;
  }
  // ponytail: one recursive readdir per miss — add a cached name index if misses get hot (a folder is ~5k files)
  let entries: string[];
  try {
    entries = await readdir(folder, { recursive: true });
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
  const byBase = new Map<string, string>();
  for (const rel of entries) {
    const key = lc(path.basename(rel));
    if (!byBase.has(key)) byBase.set(key, rel);
  }
  for (const c of wanted) {
    const rel = byBase.get(lc(c));
    const hit = rel && (await contained(realRoot, path.join(folder, rel)));
    if (hit) return hit;
  }
  return null;
}

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** RFC 5987 value: encodeURIComponent plus the characters it leaves bare that attr-char does not allow. */
const encode5987 = (s: string): string => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Stream an ALREADY-authorized legacy file. PDFs and images open in the browser; Word files download. */
export async function legacyFileResponse(absPath: string): Promise<NextResponse> {
  const size = (await stat(absPath)).size;
  const name = path.basename(absPath);
  const ext = path.extname(name).toLowerCase();
  const type = TYPES[ext] ?? "application/octet-stream";
  const inline = type === "application/pdf" || type.startsWith("image/");
  // Plain-ASCII fallback first (old clients), then the real name for everything that understands filename*.
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${ascii}"${ascii === name ? "" : `; filename*=UTF-8''${encode5987(name)}`}`;
  return new NextResponse(Readable.toWeb(createReadStream(absPath)) as unknown as ReadableStream, {
    headers: {
      "content-type": type,
      "content-length": String(size),
      "content-disposition": disposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
