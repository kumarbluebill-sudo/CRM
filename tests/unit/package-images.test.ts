import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, processPackageImage, sniffImage } from "@/lib/packages/images";

const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 100, b: 200 } } })
    .jpeg()
    .toBuffer();

describe("package photo processing", () => {
  it("identifies images by their bytes", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(sniffImage(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("crops to the requested ratio and keeps within the output size", async () => {
    const r = await processPackageImage(await jpeg(1600, 1000), "16:9");
    expect(Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.02);
    const sq = await processPackageImage(await jpeg(1600, 1000), "1:1", "LEFT");
    expect(sq.width).toBe(sq.height);
    const big = await processPackageImage(await jpeg(4000, 3000), "ORIGINAL");
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(2000);
    expect(Math.abs(big.width / big.height - 4 / 3)).toBeLessThan(0.01);
  });

  it("always outputs a JPEG without metadata", async () => {
    const withExif = await sharp(await jpeg(800, 600))
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    const r = await processPackageImage(withExif);
    const meta = await sharp(r.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("refuses wrong types, tiny images, empty and oversized input", async () => {
    for (const bad of [
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      await jpeg(100, 80),
      new Uint8Array(0),
      new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff),
    ])
      await expect(processPackageImage(bad)).rejects.toBeInstanceOf(ImageError);
  });
});
