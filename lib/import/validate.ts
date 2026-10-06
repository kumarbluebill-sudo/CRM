export const MAX_IMPORT_BYTES = 4 * 1024 * 1024; // Vercel serverless request bodies are capped near 4.5 MB

export type ImportFileType = "PDF" | "DOCX" | "XLSX" | "TXT";

const RULES: Record<string, { type: ImportFileType; mimes: string[] }> = {
  pdf: { type: "PDF", mimes: ["application/pdf"] },
  docx: {
    type: "DOCX",
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  xlsx: {
    type: "XLSX",
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  txt: { type: "TXT", mimes: ["text/plain"] },
};

export type FileCheck =
  { ok: true; type: ImportFileType; safeName: string } | { ok: false; error: string };

/** Display-only name. The stored/processed identity never depends on the client's filename. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 100);
  return cleaned || "document";
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);

/**
 * Validates size, extension, declared MIME type and the file's real signature.
 * The signature check stops e.g. an .exe renamed to .pdf.
 */
export function validateImportFile(
  file: { name: string; size: number; type: string },
  head: Uint8Array,
): FileCheck {
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "The file is larger than 4 MB." };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const rule = RULES[ext];
  if (!rule) return { ok: false, error: "Only PDF, DOCX, XLSX and TXT files are supported." };

  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (mime && mime !== "application/octet-stream" && !rule.mimes.includes(mime)) {
    return { ok: false, error: "The file type does not match its extension." };
  }

  const pdf = startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  const zip = startsWith(head, [0x50, 0x4b, 0x03, 0x04]); // PK..
  if (rule.type === "PDF" && !pdf) return { ok: false, error: "This is not a valid PDF file." };
  if ((rule.type === "DOCX" || rule.type === "XLSX") && !zip) {
    return { ok: false, error: `This is not a valid ${rule.type} file.` };
  }
  if (rule.type === "TXT" && head.slice(0, 2048).includes(0)) {
    return { ok: false, error: "This does not look like a plain text file." };
  }
  return { ok: true, type: rule.type, safeName: safeDisplayName(file.name) };
}
