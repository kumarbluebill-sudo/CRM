import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { BackupError } from "./target";

/**
 * One agency's backup file: NDJSON (a header line, one line per row, a footer with the row counts), gzip-compressed,
 * then sealed with AES-256-GCM. The organization id is bound in as authenticated data, so a file cannot be opened as
 * another agency's. A missing footer means the file was cut short, which is reported as corruption.
 */
const MAGIC = Buffer.from("CRMBK1\n", "utf8");
const FORMAT = "crm-backup";

export type ArchiveSource = {
  tables(): Promise<string[]>;
  rows(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
};

export type ArchiveHeader = {
  format: typeof FORMAT;
  v: 1;
  organizationId: string;
  createdAt: string;
  tables: string[];
};

export function parseBackupKey(b64: string | undefined): Buffer {
  const key = Buffer.from(b64 ?? "", "base64");
  if (key.length !== 32) throw new BackupError("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64.");
  return key;
}

export async function buildArchive(
  source: ArchiveSource,
  organizationId: string,
  opts: { now?: Date; pageSize?: number } = {},
): Promise<{ gz: Buffer; rowCounts: Record<string, number> }> {
  const tables = await source.tables();
  const pageSize = opts.pageSize ?? 500;
  const lines: string[] = [];
  const header: ArchiveHeader = {
    format: FORMAT,
    v: 1,
    organizationId,
    createdAt: (opts.now ?? new Date()).toISOString(),
    tables,
  };
  lines.push(JSON.stringify(header));
  const rowCounts: Record<string, number> = {};
  for (const t of tables) {
    let offset = 0;
    rowCounts[t] = 0;
    for (;;) {
      const page = await source.rows(t, offset, pageSize);
      for (const r of page) lines.push(JSON.stringify({ t, r }));
      rowCounts[t] += page.length;
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }
  lines.push(JSON.stringify({ end: true, rowCounts }));
  return { gz: gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8")), rowCounts };
}

export function sealArchive(gz: Buffer, key: Buffer, organizationId: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${FORMAT}:${organizationId}`, "utf8"));
  const ct = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function unsealArchive(sealed: Buffer, key: Buffer, organizationId: string): Buffer {
  if (sealed.length < MAGIC.length + 28 || !sealed.subarray(0, MAGIC.length).equals(MAGIC))
    throw new BackupError("This is not a backup file (or it is damaged).");
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = sealed.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ct = sealed.subarray(MAGIC.length + 28);
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(`${FORMAT}:${organizationId}`, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new BackupError("The backup could not be decrypted: it is damaged or the key is wrong.");
  }
}

export type ParsedArchive = {
  header: ArchiveHeader;
  tables: Record<string, Record<string, unknown>[]>;
  counted: Record<string, number>;
  declared: Record<string, number>;
};

export function parseArchive(gz: Buffer): ParsedArchive {
  let text: string;
  try {
    text = gunzipSync(gz).toString("utf8");
  } catch {
    throw new BackupError("The backup is corrupt (it cannot be decompressed).");
  }
  const lines = text.split("\n").filter(Boolean);
  let header: ArchiveHeader;
  let footer: { end?: boolean; rowCounts?: Record<string, number> } | undefined;
  const tables: Record<string, Record<string, unknown>[]> = {};
  try {
    header = JSON.parse(lines[0]) as ArchiveHeader;
    if (header.format !== FORMAT || header.v !== 1) throw new Error("format");
    for (const t of header.tables) tables[t] = [];
    for (let i = 1; i < lines.length; i++) {
      const o = JSON.parse(lines[i]);
      if (o.end) footer = o;
      else if (tables[o.t]) tables[o.t].push(o.r);
      else throw new Error("unexpected table");
    }
  } catch {
    throw new BackupError("The backup is corrupt (it cannot be read).");
  }
  if (!footer?.rowCounts) throw new BackupError("The backup is incomplete (it was cut short).");
  const counted = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return { header, tables, counted, declared: footer.rowCounts };
}

function sameCounts(a: Record<string, number>, b: Record<string, number>) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * Proves a stored copy is good: the hash matches what was recorded, it decrypts for this agency, it is complete, and
 * the rows actually present match both the footer and the counts recorded in the database.
 */
export function verifyArchive(
  sealed: Buffer,
  key: Buffer,
  organizationId: string,
  expected: { sha256?: string | null; rowCounts?: Record<string, number> | null },
): ParsedArchive {
  if (expected.sha256) {
    const got = createHash("sha256").update(sealed).digest();
    const want = Buffer.from(expected.sha256, "hex");
    if (want.length !== got.length || !timingSafeEqual(got, want))
      throw new BackupError("The stored backup does not match its recorded checksum.");
  }
  const parsed = parseArchive(unsealArchive(sealed, key, organizationId));
  if (parsed.header.organizationId !== organizationId)
    throw new BackupError("The backup belongs to a different agency.");
  if (!sameCounts(parsed.counted, parsed.declared))
    throw new BackupError("The backup row counts do not add up.");
  if (expected.rowCounts && !sameCounts(parsed.counted, expected.rowCounts))
    throw new BackupError("The backup does not match the row counts recorded when it was taken.");
  return parsed;
}
