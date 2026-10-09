import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, parseCsv } from "@/lib/visa/csv-parse";

const cols = IMPORT_COLUMNS.countries;

describe("visa CSV parsing", () => {
  it("reads headers, quotes, escaped quotes, CRLF and a BOM", () => {
    const r = parseCsv(
      '﻿Name,ISO Code,region\r\n"Korea, South",kr,Asia\r\n"He said ""hi""",jp,\r\n',
      cols,
    );
    expect(r.error).toBeUndefined();
    expect(r.rows).toEqual([
      { name: "Korea, South", iso_code: "kr", region: "Asia" },
      { name: 'He said "hi"', iso_code: "jp", region: "" },
    ]);
  });

  it("keeps formula-looking text as plain data (it is never executed or exported unescaped)", () => {
    expect(parseCsv("name,iso_code\n=1+1,XX", cols).rows[0].name).toBe("=1+1");
  });

  it("rejects unknown or duplicate columns, empty files and oversized input", () => {
    expect(parseCsv("name,secret\na,b", cols).error).toMatch(/Unknown column/);
    expect(parseCsv("name,name\na,b", cols).error).toMatch(/unique/);
    expect(parseCsv("name,iso_code", cols).error).toMatch(/header row/);
    expect(parseCsv("x".repeat(300_001), cols).error).toMatch(/too large/);
    const many =
      "name,iso_code\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => "a,AA").join("\n");
    expect(parseCsv(many, cols).error).toMatch(/At most/);
  });

  it("skips blank lines", () => {
    expect(parseCsv("name,iso_code\n\na,AA\n\n", cols).rows).toHaveLength(1);
  });
});
