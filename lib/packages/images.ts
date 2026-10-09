import "server-only";
import sharp from "sharp";
import { getStorage } from "@/lib/storage";

export const MAX_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PX = 8000;
export const OUTPUT_MAX_EDGE = 2000;

export type Aspect = "ORIGINAL" | "16:9" | "4:3" | "1:1" | "3:4";
export type Focus = "CENTER" | "TOP" | "BOTTOM" | "LEFT" | "RIGHT";
export const ASPECTS: Aspect[] = ["ORIGINAL", "16:9", "4:3", "1:1", "3:4"];
export const FOCUSES: Focus[] = ["CENTER", "TOP", "BOTTOM", "LEFT", "RIGHT"];

export class ImageError extends Error {}

const RATIO: Record<Exclude<Aspect, "ORIGINAL">, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "3:4": 3 / 4,
};
const GRAVITY: Record<Focus, string> = {
  CENTER: "centre",
  TOP: "north",
  BOTTOM: "south",
  LEFT: "west",
  RIGHT: "east",
};

/** JPEG, PNG or WebP by signature. Everything else (SVG, GIF, HEIC, documents renamed to .jpg) is refused. */
export function sniffImage(b: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "webp";
  return null;
}

/**
 * Validates, crops, resizes and re-encodes an upload as a progressive JPEG (the format PDFs and browsers all handle).
 * Rotation from camera metadata is applied and all metadata (GPS, device) is stripped.
 */
export async function processPackageImage(
  bytes: Uint8Array,
  aspect: Aspect = "ORIGINAL",
  focus: Focus = "CENTER",
) {
  if (bytes.byteLength === 0) throw new ImageError("Choose a photo to upload.");
  if (bytes.byteLength > MAX_IMAGE_INPUT_BYTES)
    throw new ImageError("The photo must be 5 MB or smaller.");
  if (!sniffImage(bytes)) throw new ImageError("Use a JPEG, PNG or WebP photo.");
  try {
    const input = Buffer.from(bytes);
    const opts = { limitInputPixels: MAX_IMAGE_PX * MAX_IMAGE_PX };
    const oriented = await sharp(input, opts).rotate().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = oriented.info;
    if (!w || !h) throw new ImageError("That photo could not be read.");
    if (w < 300 || h < 200)
      throw new ImageError("The photo is too small. Use at least 300x200 pixels.");
    if (w > MAX_IMAGE_PX || h > MAX_IMAGE_PX)
      throw new ImageError("The photo is too large. Use at most 8000 pixels on a side.");
    // sharp keeps only the last resize in a pipeline, so the crop is its own step
    let source: Buffer = oriented.data;
    if (aspect !== "ORIGINAL") {
      const r = RATIO[aspect];
      // largest region of that ratio that fits, anchored by the chosen focus
      const cw = w / h > r ? Math.round(h * r) : w;
      const ch = w / h > r ? h : Math.round(w / r);
      source = await sharp(oriented.data, opts)
        .resize({ width: cw, height: ch, fit: "cover", position: GRAVITY[focus] })
        .toBuffer();
    }
    const pipeline = sharp(source, opts);
    const out = await pipeline
      .resize({
        width: OUTPUT_MAX_EDGE,
        height: OUTPUT_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data: out.data, width: out.info.width, height: out.info.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("That photo could not be read. Try saving it again as a JPEG.");
  }
}

/** Reads one stored image through a short-lived signed URL (server side only; the URL never reaches the browser). */
export async function readStoredImage(path: string): Promise<Buffer> {
  const url = await getStorage().signedUrl(path, 60);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
