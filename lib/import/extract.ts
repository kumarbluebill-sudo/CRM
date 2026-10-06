import "server-only";
import type { ImportFileType } from "@/lib/import/validate";
import { normalizeText } from "@/lib/import/parse";

const TIMEOUT_MS = 25_000;
const MAX_PDF_PAGES = 60;
const MAX_SHEET_ROWS = 2000;

export class ExtractionError extends Error {}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new ExtractionError("Reading the document took too long.")),
        TIMEOUT_MS,
      ),
    ),
  ]);
}

async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new ExtractionError(`The PDF has more than ${MAX_PDF_PAGES} pages.`);
  }
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function docxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function xlsxText(buffer: Buffer): Promise<string> {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const sheets = (await readXlsxFile(buffer)).slice(0, 5);
  const out: string[] = [];
  for (const { data } of sheets) {
    for (const row of data.slice(0, MAX_SHEET_ROWS)) {
      const cells = row
        .map((c) =>
          c === null || c === undefined
            ? ""
            : c instanceof Date
              ? c.toISOString().slice(0, 10)
              : String(c).trim(),
        )
        .filter(Boolean);
      if (cells.length) out.push(cells.join(" – "));
    }
  }
  return out.join("\n");
}

/** Extracts plain text. The file is processed in memory only and never written to disk. */
export async function extractText(type: ImportFileType, buffer: Buffer): Promise<string> {
  try {
    const raw = await withTimeout(
      type === "PDF"
        ? pdfText(buffer)
        : type === "DOCX"
          ? docxText(buffer)
          : type === "XLSX"
            ? xlsxText(buffer)
            : Promise.resolve(buffer.toString("utf8")),
    );
    return normalizeText(raw);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(
      "The document could not be read. It may be damaged or password-protected.",
    );
  }
}
