import "server-only";
import sharp from "sharp";
import {
  LOGO_BOX,
  MAX_LOGO_INPUT_BYTES,
  MAX_LOGO_PX,
  MIN_LOGO_PX,
  checkSvg,
  sniffLogo,
} from "@/lib/branding/logo";

/** A problem the user can fix; its message is safe to show. */
export class LogoError extends Error {}

export type ProcessedLogo = { dataUri: string; width: number; height: number };

/**
 * Validates and re-encodes an uploaded logo. Whatever comes in (PNG, JPEG, WebP or a vetted SVG) the stored result is a
 * freshly encoded PNG, so no original bytes, metadata or markup are ever kept or served, and PDFs (which only embed
 * PNG/JPEG) always work. Throws LogoError with a user-safe message on any problem.
 */
export async function processLogo(bytes: Uint8Array): Promise<ProcessedLogo> {
  if (bytes.byteLength === 0) throw new LogoError("Choose an image to upload.");
  if (bytes.byteLength > MAX_LOGO_INPUT_BYTES)
    throw new LogoError("The logo must be 2 MB or smaller.");
  const kind = sniffLogo(bytes);
  if (!kind) throw new LogoError("The logo must be a PNG, JPEG, WebP or SVG image.");
  if (kind === "svg") {
    const problem = checkSvg(new TextDecoder().decode(bytes));
    if (problem) throw new LogoError(problem);
  }
  const input = Buffer.from(bytes);
  try {
    const opts = {
      limitInputPixels: MAX_LOGO_PX * MAX_LOGO_PX,
      density: kind === "svg" ? 300 : undefined,
    };
    const meta = await sharp(input, opts).metadata();
    if (!meta.width || !meta.height)
      throw new LogoError("That image could not be read. Try exporting it again as PNG.");
    if (kind !== "svg" && (meta.width < MIN_LOGO_PX || meta.height < MIN_LOGO_PX))
      throw new LogoError(
        `The logo is too small. Use at least ${MIN_LOGO_PX}x${MIN_LOGO_PX} pixels.`,
      );
    if (meta.width > MAX_LOGO_PX || meta.height > MAX_LOGO_PX)
      throw new LogoError(
        `The logo is too large. Use at most ${MAX_LOGO_PX}x${MAX_LOGO_PX} pixels.`,
      );

    const base = () =>
      sharp(input, opts)
        .rotate()
        .resize({ ...LOGO_BOX, fit: "inside", withoutEnlargement: kind !== "svg" });
    let out = await base().png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    if (out.data.byteLength > 450_000)
      out = await base()
        .png({ palette: true, quality: 85, compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
    if (out.data.byteLength > 450_000)
      throw new LogoError("The logo is too detailed. Please use a simpler or smaller image.");
    return {
      dataUri: `data:image/png;base64,${out.data.toString("base64")}`,
      width: out.info.width,
      height: out.info.height,
    };
  } catch (e) {
    if (e instanceof LogoError) throw e;
    throw new LogoError("That image could not be read. Try exporting it again as PNG.");
  }
}
