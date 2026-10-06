/**
 * CSV for spreadsheet users. Cells starting with = + - @ (or a tab/CR) are prefixed with an apostrophe so Excel and
 * Sheets never run them as formulas (CSV injection), then quoted per RFC 4180.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  columns: { key: string; header: string }[],
  rows: Record<string, unknown>[],
): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","));
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}
