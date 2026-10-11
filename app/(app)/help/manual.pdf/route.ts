import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { articleBlocks, visibleArticles } from "@/lib/help/articles";
import { filterBlocks, type Block } from "@/lib/help/markdown";
import { ManualPdf, type ManualSection } from "@/lib/pdf/manual-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

function imagePaths(blocks: Block[]): string[] {
  return blocks.flatMap((b) =>
    b.t === "img" ? [b.src] : b.t === "gate" ? imagePaths(b.blocks) : [],
  );
}

/** The user manual as one PDF, built from the same guides as the Help center and limited to what the reader's role allows. */
export async function GET() {
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization) return json(403, "Forbidden.");
  if (!(await rateLimit(`manual:${session.userId}`, 5, 60_000)).allowed)
    return json(429, "Too many requests.");
  try {
    const has = (p: string) => session.permissions.has(p as never);
    const sections: ManualSection[] = visibleArticles(has).map((a) => ({
      title: a.title,
      category: a.category,
      blocks: filterBlocks(articleBlocks(a), has),
    }));
    const images = new Map<string, Buffer>();
    for (const src of new Set(sections.flatMap((s) => imagePaths(s.blocks)))) {
      try {
        // src is validated by the Markdown parser to /guide-img/<file> only
        images.set(src, await readFile(path.join(process.cwd(), "public", src)));
      } catch {
        /* a missing screenshot leaves a gap rather than failing the manual */
      }
    }
    const pdf = await renderToBuffer(
      createElement(ManualPdf, {
        organization: session.organization.name,
        generatedOn: new Date().toISOString().slice(0, 10),
        sections,
        images,
      }) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="smart-travel-crm-manual.pdf"',
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    logger.error("manual pdf failed", { error: e instanceof Error ? e.message : "unknown" });
    return json(500, "The manual could not be created.");
  }
}
