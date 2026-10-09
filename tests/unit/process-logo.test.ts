import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LogoError, processLogo } from "@/lib/branding/process-logo";

const png = (w: number, h: number) =>
  sharp({
    create: { width: w, height: h, channels: 4, background: { r: 20, g: 90, b: 160, alpha: 1 } },
  })
    .png()
    .toBuffer();
const decode = (uri: string) => Buffer.from(uri.split(",")[1], "base64");

describe("processLogo", () => {
  it("re-encodes a large PNG as a smaller PNG inside the logo box", async () => {
    const r = await processLogo(await png(2400, 900));
    expect(r.dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(r.width).toBeLessThanOrEqual(800);
    expect(r.height).toBeLessThanOrEqual(320);
    expect(Math.abs(r.width / r.height - 2400 / 900)).toBeLessThan(0.05); // aspect ratio kept
    expect((await sharp(decode(r.dataUri)).metadata()).format).toBe("png");
  });

  it("converts JPEG and WebP, and does not upscale small images", async () => {
    const jpeg = await sharp(await png(300, 100))
      .jpeg()
      .toBuffer();
    const webp = await sharp(await png(300, 100))
      .webp()
      .toBuffer();
    for (const input of [jpeg, webp]) {
      const r = await processLogo(input);
      expect([r.width, r.height]).toEqual([300, 100]);
    }
  });

  it("rasterises a safe SVG to PNG", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#0a5"/></svg>';
    const r = await processLogo(new TextEncoder().encode(svg));
    expect((await sharp(decode(r.dataUri)).metadata()).format).toBe("png");
    expect(r.width / r.height).toBeCloseTo(2.5, 1);
  });

  it("rejects unsafe SVG, wrong types, tiny images and oversized files with a clear message", async () => {
    const bad = [
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
      new TextEncoder().encode("just some text"),
      await png(10, 10),
      new Uint8Array(0),
      new Uint8Array(2 * 1024 * 1024 + 1),
    ];
    for (const b of bad) await expect(processLogo(b)).rejects.toBeInstanceOf(LogoError);
  });

  it("rejects a corrupt image without leaking internals", async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from("not really a png"),
    ]);
    await expect(processLogo(corrupt)).rejects.toThrow(/could not be read/);
  });
});
