import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex, signV4 } from "./sigv4";

/**
 * Where backups are stored. Provider-agnostic: an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO,
 * Supabase Storage S3) for real use, or a local folder for development and tests. Objects are always already encrypted
 * before they reach a target, so a target never sees plaintext.
 */
export interface BackupTarget {
  readonly kind: "local" | "s3";
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class BackupError extends Error {}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,298}$/;
export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//"))
    throw new BackupError("Invalid backup object name.");
}

export class LocalTarget implements BackupTarget {
  readonly kind = "local" as const;
  constructor(private readonly dir: string) {}
  private file(key: string) {
    assertSafeKey(key);
    return path.join(this.dir, ...key.split("/"));
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      throw new BackupError("The stored backup could not be read.");
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (rel: string) => {
      let entries;
      try {
        entries = await readdir(path.join(this.dir, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const next = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(next);
        else if (next.startsWith(prefix)) out.push(next);
      }
    };
    await walk("");
    return out.sort();
  }
}

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class S3Target implements BackupTarget {
  readonly kind = "s3" as const;
  constructor(
    private readonly cfg: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private url(key: string, query?: Record<string, string>) {
    const base = this.cfg.endpoint.replace(/\/$/, "");
    const u = new URL(`${base}/${this.cfg.bucket}/${key}`);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u;
  }

  private async call(method: string, url: URL, body?: Buffer): Promise<Response> {
    const headers = signV4({
      method,
      url,
      headers: body ? { "content-type": "application/octet-stream" } : {},
      payloadSha256: sha256Hex(body ?? ""),
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      region: this.cfg.region,
      now: this.clock(),
    });
    delete headers.host; // set by fetch from the URL
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new BackupError("The backup destination could not be reached.");
    }
    return res;
  }

  async put(key: string, data: Buffer) {
    assertSafeKey(key);
    const res = await this.call("PUT", this.url(key), data);
    if (!res.ok)
      throw new BackupError(`The backup destination refused the upload (${res.status}).`);
  }
  async get(key: string) {
    assertSafeKey(key);
    const res = await this.call("GET", this.url(key));
    if (!res.ok) throw new BackupError(`The stored backup could not be read (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(key: string) {
    assertSafeKey(key);
    const res = await this.call("DELETE", this.url(key));
    if (!res.ok && res.status !== 404)
      throw new BackupError(`The backup could not be deleted (${res.status}).`);
  }
  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const u = new URL(`${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}`);
      u.searchParams.set("list-type", "2");
      u.searchParams.set("prefix", prefix);
      if (token) u.searchParams.set("continuation-token", token);
      const res = await this.call("GET", u);
      if (!res.ok) throw new BackupError(`The destination could not be listed (${res.status}).`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
    } while (token);
    return keys;
  }
}

type TargetEnv = {
  BACKUP_S3_ENDPOINT?: string;
  BACKUP_S3_BUCKET?: string;
  BACKUP_S3_REGION?: string;
  BACKUP_S3_ACCESS_KEY_ID?: string;
  BACKUP_S3_SECRET_ACCESS_KEY?: string;
  BACKUP_LOCAL_DIR?: string;
  APP_ENV?: string;
};

/**
 * S3 when its variables are all present. A local folder is accepted only outside production (a serverless disk is
 * not durable). Otherwise null: the UI says no destination is configured and no backup is attempted.
 */
export function backupTargetFromEnv(env: TargetEnv): BackupTarget | null {
  if (
    env.BACKUP_S3_ENDPOINT &&
    env.BACKUP_S3_BUCKET &&
    env.BACKUP_S3_ACCESS_KEY_ID &&
    env.BACKUP_S3_SECRET_ACCESS_KEY
  ) {
    const url = new URL(env.BACKUP_S3_ENDPOINT);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return null;
    return new S3Target({
      endpoint: env.BACKUP_S3_ENDPOINT,
      bucket: env.BACKUP_S3_BUCKET,
      region: env.BACKUP_S3_REGION || "us-east-1",
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
    });
  }
  if (env.BACKUP_LOCAL_DIR && env.APP_ENV !== "production")
    return new LocalTarget(env.BACKUP_LOCAL_DIR);
  return null;
}
