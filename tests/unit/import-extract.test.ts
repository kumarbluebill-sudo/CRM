import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph } from "docx";
import writeXlsxFile from "write-excel-file/node";
import { extractText, ExtractionError } from "@/lib/import/extract";
import { parseItineraryText } from "@/lib/import/parse";

const LINES = [
  "Bali Honeymoon Package",
  "Day 1 - Arrival",
  "Airport pickup",
  "Day 2 - Ubud tour",
  "Breakfast at hotel",
];

/** Minimal single-page PDF with one line of text per entry (xref is rebuilt by the reader). */
function makePdf(lines: string[]): Buffer {
  const content = [
    "BT /F1 12 Tf 14 TL 50 750 Td",
    ...lines.map((l) => `(${l.replace(/[()\\]/g, "")}) Tj T*`),
    "ET",
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

describe("extractText", () => {
  it("reads TXT", async () => {
    expect(await extractText("TXT", Buffer.from(LINES.join("\n")))).toContain("Day 1 - Arrival");
  });

  it("reads a DOCX and the result parses into days", async () => {
    const doc = new Document({ sections: [{ children: LINES.map((l) => new Paragraph(l)) }] });
    const text = await extractText("DOCX", Buffer.from(await Packer.toBuffer(doc)));
    expect(text).toContain("Bali Honeymoon Package");
    expect(parseItineraryText(text).days).toHaveLength(2);
  });

  it("reads an XLSX (rows become lines)", async () => {
    const rows = [["Day 1", "Arrival"], ["Airport pickup"], ["Day 2", "Ubud tour"]].map((r) =>
      r.map((value) => ({ value })),
    );
    const buf = (await writeXlsxFile(rows).toBuffer()) as Buffer;
    const text = await extractText("XLSX", Buffer.from(buf));
    expect(text).toContain("Day 1 – Arrival");
    expect(parseItineraryText(text).days).toHaveLength(2);
  });

  it("reads a PDF", async () => {
    const text = await extractText("PDF", makePdf(LINES));
    expect(text).toContain("Bali Honeymoon Package");
    expect(text).toContain("Ubud tour");
  });

  it("fails safely on corrupt files", async () => {
    await expect(extractText("PDF", Buffer.from("%PDF-1.4 garbage"))).rejects.toBeInstanceOf(
      ExtractionError,
    );
    await expect(
      extractText("DOCX", Buffer.from("PK\u0003\u0004 not really a zip")),
    ).rejects.toBeInstanceOf(ExtractionError);
    await expect(extractText("XLSX", Buffer.from("PK\u0003\u0004 nope"))).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
