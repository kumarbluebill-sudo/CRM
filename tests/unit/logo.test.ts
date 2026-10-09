import { describe, expect, it } from "vitest";
import { checkSvg, sniffLogo } from "@/lib/branding/logo";

const enc = (s: string) => new TextEncoder().encode(s);

describe("logo file checks", () => {
  it("identifies files by their bytes, not by name", () => {
    expect(sniffLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("png");
    expect(sniffLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffLogo(enc("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffLogo(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(sniffLogo(enc('<?xml version="1.0"?><svg></svg>'))).toBe("svg");
    expect(sniffLogo(enc("MZ\u0090\u0000 not an image"))).toBeNull();
    expect(sniffLogo(enc("<html><svg></svg></html>"))).toBeNull();
  });

  it("accepts plain vector artwork", () => {
    const ok =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><path d="M0 0L10 10"/></svg>';
    expect(checkSvg(ok)).toBeNull();
  });

  it.each([
    ["script", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["event handler", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
    [
      "foreignObject",
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
    ],
    [
      "embedded image",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.test/x.png"/></svg>',
    ],
    [
      "href link",
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
    ],
    [
      "xlink use",
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="file:///etc/passwd"/></svg>',
    ],
    [
      "external url()",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(http://evil.test/a)"/></svg>',
    ],
    [
      "doctype entity",
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
    ],
    [
      "style import",
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(http://evil.test/a.css);</style></svg>',
    ],
    [
      "remote reference in text",
      '<svg xmlns="http://www.w3.org/2000/svg"><text>https://evil.test</text></svg>',
    ],
  ])("refuses an SVG with %s", (_name, svg) => {
    expect(checkSvg(svg)).not.toBeNull();
  });

  it("refuses an oversized SVG", () => {
    expect(checkSvg("<svg>" + "x".repeat(210_000) + "</svg>")).toMatch(/too large/);
  });
});
