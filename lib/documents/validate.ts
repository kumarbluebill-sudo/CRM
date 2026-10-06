export const DOCUMENT_CATEGORIES = [
  "PASSPORT",
  "VISA",
  "FLIGHT_TICKET",
  "HOTEL_VOUCHER",
  "TRANSFER_VOUCHER",
  "INSURANCE",
  "INVOICE",
  "RECEIPT",
  "ITINERARY",
  "QUOTATION",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const SENSITIVE_CATEGORIES: readonly DocumentCategory[] = ["PASSPORT", "VISA"];

/** Vercel serverless bodies are capped near 4.5 MB. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

const TYPES: Record<string, { mime: string; sig: (b: Uint8Array) => boolean }> = {
  pdf: { mime: "application/pdf", sig: (b) => eq(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  png: { mime: "image/png", sig: (b) => eq(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: "image/jpeg", sig: (b) => eq(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", sig: (b) => eq(b, [0xff, 0xd8, 0xff]) },
  txt: { mime: "text/plain", sig: (b) => !b.subarray(0, 2048).includes(0) },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sig: (b) => eq(b, [0x50, 0x4b, 0x03, 0x04]),
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sig: (b) => eq(b, [0x50, 0x4b, 0x03, 0x04]),
  },
};
const eq = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export type DocumentCheck =
  { ok: true; ext: string; mime: string; displayName: string } | { ok: false; error: string };

/** Display name only; the stored object name is always a random UUID. */
export function safeDocumentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return (
    base
      .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
      .replace(/\.{2,}/g, ".")
      .slice(0, 120) || "document"
  );
}

export function validateDocumentFile(
  file: { name: string; size: number; type: string },
  head: Uint8Array,
): DocumentCheck {
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, error: "The file is larger than 4 MB." };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const rule = TYPES[ext];
  if (!rule) return { ok: false, error: "Allowed types: PDF, DOCX, XLSX, TXT, PNG, JPG." };
  const declared = file.type.toLowerCase().split(";")[0].trim();
  if (declared && declared !== "application/octet-stream" && declared !== rule.mime) {
    return { ok: false, error: "The file type does not match its extension." };
  }
  if (!rule.sig(head)) return { ok: false, error: "The file contents do not match its type." };
  return {
    ok: true,
    ext: ext === "jpeg" ? "jpg" : ext,
    mime: rule.mime,
    displayName: safeDocumentName(file.name),
  };
}
