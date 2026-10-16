import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { loadPdfImages, loadStudioData, type StudioData } from "@/lib/itinerary-pdf/load";
import { buildItineraryPdfModel, pickQuote, type ItineraryPdfModel } from "@/lib/itinerary-pdf/model";
import { ItineraryPdf } from "@/lib/pdf/itinerary-pdf";
import type { PdfSettings } from "@/lib/itinerary-pdf/themes";

export type RenderedItineraryPdf = {
  buffer: Buffer;
  filename: string;
  model: ItineraryPdfModel;
  data: StudioData;
};

/** "<quotation number or itinerary title>-itinerary.pdf", with anything unsafe for a file name removed. */
export function pdfFileName(label: string): string {
  const base = label.replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "itinerary";
  return `${base}-itinerary.pdf`;
}

/** Renders the PDF with the saved settings, optionally overridden by a chosen quotation/option. Null when the itinerary is not visible to the caller. */
export async function renderItineraryPdf(
  id: string,
  orgName: string,
  override: Partial<Pick<PdfSettings, "quotationId" | "optionId">> = {},
): Promise<RenderedItineraryPdf | null> {
  const data = await loadStudioData(id, orgName);
  if (!data) return null;
  const settings: PdfSettings = {
    ...data.settings,
    quotationId: override.quotationId ?? data.settings.quotationId,
    optionId: override.optionId ?? data.settings.optionId,
  };
  const model = buildItineraryPdfModel(data.source, settings);
  const images = await loadPdfImages([model.coverImageId, ...model.days.map((d) => d.imageId)]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(createElement(ItineraryPdf, { model, images }) as any);
  const picked = pickQuote(data.source.quotations, settings);
  return {
    buffer,
    filename: pdfFileName(picked?.quotation.number || model.title),
    model,
    data,
  };
}
