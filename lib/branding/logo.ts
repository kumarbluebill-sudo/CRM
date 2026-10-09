export const MAX_LOGO_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_SVG_BYTES = 200 * 1024;
export const MIN_LOGO_PX = 32;
export const MAX_LOGO_PX = 6000;
/** The stored logo fits inside this box; it is plenty for sidebar, invoices and PDFs and keeps pages light. */
export const LOGO_BOX = { width: 800, height: 320 };

export type LogoKind = "png" | "jpeg" | "webp" | "svg";

/** Identifies the file by its bytes, never by name or the browser-supplied type. */
export function sniffLogo(bytes: Uint8Array): LogoKind | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/**
 * SVG is accepted only if it is plain vector artwork. The file is never served to a browser as SVG (it is rasterised to
 * PNG on the server), but anything that could make the renderer fetch or execute something is refused outright rather
 * than "cleaned", because a refusal cannot be bypassed by clever markup. Returns an error message, or null if fine.
 */
export function checkSvg(text: string): string | null {
  if (text.length > MAX_SVG_BYTES) return "The SVG is too large (200 KB maximum).";
  const t = text.replace(/\0/g, "");
  if (/<!doctype|<!entity|<!\[cdata\[(?=[\s\S]*<script)/i.test(t))
    return "This SVG uses features that are not allowed.";
  if (
    /<\s*(script|foreignobject|iframe|object|embed|audio|video|canvas|image|use|a|style|animate|set|handler|link|meta)\b/i.test(
      t,
    )
  )
    return "This SVG contains elements that are not allowed (scripts, images, links or styles).";
  if (/\son[a-z]+\s*=/i.test(t)) return "This SVG contains event handlers, which are not allowed.";
  if (/(?:xlink:)?href\s*=/i.test(t)) return "This SVG contains links, which are not allowed.";
  if (/url\s*\(\s*(?!['"]?#)/i.test(t)) return "This SVG refers to an external resource.";
  if (
    /@import|javascript:|data:|file:|https?:\/\//i.test(
      t.replace(/xmlns(:\w+)?\s*=\s*["'][^"']*["']/gi, ""),
    )
  )
    return "This SVG refers to an external resource.";
  return null;
}
