import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible storage, using only Node's crypto (no SDK). Pure: the caller supplies the
 * time, so it can be checked against AWS's published test vectors.
 */
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();
export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** RFC 3986 encoding as S3 expects it (each path segment encoded once; "/" kept). */
function encodeSegment(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export type SignInput = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadSha256: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  now: Date;
};

/** Returns the headers to send: the caller's headers plus x-amz-date, x-amz-content-sha256 and Authorization. */
export function signV4(input: SignInput): Record<string, string> {
  const service = input.service ?? "s3";
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": input.payloadSha256,
  };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const byLower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names
    .map((n) => `${n}:${byLower[n].trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const path = input.url.pathname
    .split("/")
    .map((seg) => encodeSegment(decodeURIComponent(seg)))
    .join("/");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [
    input.method.toUpperCase(),
    path || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256,
  ].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
