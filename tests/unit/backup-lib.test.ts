import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildArchive,
  parseArchive,
  sealArchive,
  unsealArchive,
  verifyArchive,
  type ArchiveSource,
} from "@/lib/backup/archive";
import { sha256Hex, signV4 } from "@/lib/backup/sigv4";
import {
  BackupError,
  LocalTarget,
  S3Target,
  assertSafeKey,
  backupTargetFromEnv,
} from "@/lib/backup/target";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const key = randomBytes(32);

function source(tables: Record<string, Record<string, unknown>[]>): ArchiveSource {
  return {
    tables: async () => Object.keys(tables),
    rows: async (t, offset, limit) => tables[t].slice(offset, offset + limit),
  };
}
const data = {
  customers: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Customer ${i}` })),
  leads: [{ id: "l1", note: "ünïcödé ₹ 1,200" }],
  empty: [],
};

describe("SigV4 signing", () => {
  it("matches the AWS documented 'GET Object' example", () => {
    const h = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadSha256: sha256Hex(""),
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("matches the AWS documented 'list objects' example (query string handling)", () => {
    const h = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
      headers: {},
      payloadSha256: sha256Hex(""),
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toContain(
      "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    );
  });
});

describe("backup archive", () => {
  it("round-trips across pages and keeps every row, including empty tables", async () => {
    const { gz, rowCounts } = await buildArchive(source(data), ORG, { pageSize: 3 });
    expect(rowCounts).toEqual({ customers: 7, leads: 1, empty: 0 });
    const sealed = sealArchive(gz, key, ORG);
    const parsed = verifyArchive(sealed, key, ORG, { rowCounts });
    expect(parsed.tables.customers).toHaveLength(7);
    expect(parsed.tables.leads[0]).toEqual(data.leads[0]);
  });

  it("is encrypted: no readable record text in the stored bytes", async () => {
    const { gz } = await buildArchive(source(data), ORG);
    const sealed = sealArchive(gz, key, ORG);
    expect(sealed.toString("utf8")).not.toContain("Customer 3");
    expect(gz.toString("latin1")).not.toContain("Customer 3"); // compressed as well
  });

  it("detects a flipped byte, a truncated file, the wrong key and another agency", async () => {
    const { gz, rowCounts } = await buildArchive(source(data), ORG);
    const sealed = sealArchive(gz, key, ORG);
    const sha = sha256Hex(sealed);

    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 5] ^= 0xff;
    expect(() => verifyArchive(flipped, key, ORG, { sha256: sha })).toThrow(/checksum/);
    expect(() => verifyArchive(flipped, key, ORG, {})).toThrow(/decrypted/);

    expect(() => verifyArchive(sealed.subarray(0, sealed.length - 40), key, ORG, {})).toThrow(
      BackupError,
    );
    expect(() => verifyArchive(sealed, randomBytes(32), ORG, {})).toThrow(/decrypted/);
    expect(() => verifyArchive(sealed, key, OTHER, {})).toThrow(/decrypted/);
    expect(() => verifyArchive(Buffer.from("not a backup"), key, ORG, {})).toThrow(/not a backup/);
    expect(() =>
      verifyArchive(sealed, key, ORG, { rowCounts: { ...rowCounts, customers: 8 } }),
    ).toThrow(/row counts/);
  });

  it("reports a file cut short before its footer as incomplete", async () => {
    const { gz } = await buildArchive(source(data), ORG);
    const { gunzipSync, gzipSync } = await import("node:zlib");
    const lines = gunzipSync(gz).toString("utf8").trim().split("\n");
    const cut = gzipSync(Buffer.from(lines.slice(0, -1).join("\n"), "utf8"));
    expect(() => parseArchive(cut)).toThrow(/cut short/);
  });

  it("uses a fresh IV every time", async () => {
    const { gz } = await buildArchive(source(data), ORG);
    expect(sealArchive(gz, key, ORG).equals(sealArchive(gz, key, ORG))).toBe(false);
    expect(unsealArchive(sealArchive(gz, key, ORG), key, ORG).equals(gz)).toBe(true);
  });
});

describe("backup targets", () => {
  let dir: string;
  afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

  it("local target stores, lists and deletes, and refuses unsafe names", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "crm-bk-"));
    const t = new LocalTarget(dir);
    await t.put("org/a/2026/x.crmbk", Buffer.from("hello"));
    await t.put("org/b/2026/y.crmbk", Buffer.from("other"));
    expect((await t.get("org/a/2026/x.crmbk")).toString()).toBe("hello");
    expect(await t.list("org/a/")).toEqual(["org/a/2026/x.crmbk"]);
    await t.delete("org/a/2026/x.crmbk");
    await expect(t.get("org/a/2026/x.crmbk")).rejects.toThrow(BackupError);
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a//b", "a b", "", "a\\b"])
      expect(() => assertSafeKey(bad), bad).toThrow(BackupError);
    await expect(t.put("../escape", Buffer.from("x"))).rejects.toThrow(BackupError);
  });

  it("S3 target signs every request and speaks path-style S3", async () => {
    const store = new Map<string, Buffer>();
    const seen: { method: string; url: string; auth: string; hash: string }[] = [];
    const fake = (async (input: URL | string, init?: RequestInit) => {
      const u = new URL(String(input));
      const h = init?.headers as Record<string, string>;
      seen.push({
        method: String(init?.method),
        url: u.toString(),
        auth: h.authorization,
        hash: h["x-amz-content-sha256"],
      });
      const k = decodeURIComponent(u.pathname.replace(/^\/bucket-1\/?/, ""));
      if (init?.method === "PUT") {
        store.set(k, Buffer.from(init.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      if (init?.method === "DELETE") {
        store.delete(k);
        return new Response(null, { status: 204 });
      }
      if (u.searchParams.get("list-type") === "2") {
        const keys = [...store.keys()].filter((x) => x.startsWith(u.searchParams.get("prefix")!));
        return new Response(
          `<ListBucketResult>${keys.map((x) => `<Key>${x}</Key>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`,
        );
      }
      return store.has(k)
        ? new Response(new Uint8Array(store.get(k)!))
        : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const t = new S3Target(
      {
        endpoint: "https://s3.example.test",
        bucket: "bucket-1",
        region: "auto",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      },
      fake,
      () => new Date("2026-01-02T03:04:05Z"),
    );
    await t.put("org/a/1.crmbk", Buffer.from("payload"));
    expect((await t.get("org/a/1.crmbk")).toString()).toBe("payload");
    expect(await t.list("org/a/")).toEqual(["org/a/1.crmbk"]);
    await t.delete("org/a/1.crmbk");
    await expect(t.get("org/a/1.crmbk")).rejects.toThrow(/could not be read/);
    expect(
      seen.every((s) =>
        /^AWS4-HMAC-SHA256 Credential=AK\/20260102\/auto\/s3\/aws4_request/.test(s.auth),
      ),
    ).toBe(true);
    expect(seen[0].hash).toBe(sha256Hex("payload"));
    expect(seen.map((s) => s.auth).join()).not.toContain("SK");
  });

  it("chooses a destination only when it is safe", () => {
    const s3 = {
      BACKUP_S3_ENDPOINT: "https://s3.example.test",
      BACKUP_S3_BUCKET: "bucket-1",
      BACKUP_S3_ACCESS_KEY_ID: "AK",
      BACKUP_S3_SECRET_ACCESS_KEY: "SK",
    };
    expect(backupTargetFromEnv({})).toBeNull();
    expect(backupTargetFromEnv(s3)?.kind).toBe("s3");
    expect(backupTargetFromEnv({ ...s3, BACKUP_S3_ENDPOINT: "http://s3.example.test" })).toBeNull();
    expect(backupTargetFromEnv({ BACKUP_LOCAL_DIR: "/tmp/x" })?.kind).toBe("local");
    expect(backupTargetFromEnv({ BACKUP_LOCAL_DIR: "/tmp/x", APP_ENV: "production" })).toBeNull();
  });
});
