export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 300_000;

export type ParsedCsv = { rows: Record<string, string>[]; error?: string };

/** Splits RFC 4180 text into records. Handles quotes, escaped quotes, embedded newlines, CRLF and a leading BOM. */
function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  return out;
}

/** Header row -> object per line. Header names are lower-cased with spaces turned into underscores. */
export function parseCsv(text: string, allowed: readonly string[]): ParsedCsv {
  if (text.length > MAX_IMPORT_BYTES)
    return { rows: [], error: "That file is too large (300 KB maximum)." };
  const recs = records(text);
  if (recs.length < 2)
    return { rows: [], error: "The file needs a header row and at least one data row." };
  const header = recs[0].map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  const unknown = header.filter((h) => !allowed.includes(h));
  if (unknown.length) return { rows: [], error: `Unknown column(s): ${unknown.join(", ")}.` };
  if (new Set(header).size !== header.length)
    return { rows: [], error: "Column names must be unique." };
  if (recs.length - 1 > MAX_IMPORT_ROWS)
    return { rows: [], error: `At most ${MAX_IMPORT_ROWS} rows can be imported at once.` };
  const rows = recs.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim().slice(0, 300);
    });
    return o;
  });
  return { rows };
}

export const IMPORT_COLUMNS = {
  countries: ["name", "iso_code", "region"],
  products: [
    "country_iso",
    "visa_type",
    "entry_type",
    "nationality",
    "stay_days",
    "validity_days",
    "passport_validity_months",
    "processing_days_normal",
    "processing_days_express",
    "service_fee",
    "express_fee",
    "markup_percent",
    "gst_percent",
    "government_fee",
    "supplier_fee",
    "source",
  ],
} as const;
export type ImportKind = keyof typeof IMPORT_COLUMNS;
