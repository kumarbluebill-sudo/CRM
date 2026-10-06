import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_KEYS,
  escapeHtml,
  oneLine,
  renderTemplate,
  textToHtml,
  whatsappLink,
} from "@/lib/comms/templates";
import { generatePortalToken, hashPortalToken, isPortalToken } from "@/lib/portal/token";
import { linkState } from "@/lib/portal/state";

describe("renderTemplate", () => {
  it("fills allowed variables and blanks unknown ones", () => {
    expect(
      renderTemplate("Hi {{customer_name}}, {{secret}}{{ org_name }}!", {
        customer_name: "Asha",
        org_name: "Acme",
        secret: "x",
      }),
    ).toBe("Hi Asha, Acme!");
  });
  it("never lets a variable value inject placeholders, control characters or huge text", () => {
    const out = renderTemplate("{{message}}", {
      message: "{{org_name}}\u0000\u0007" + "a".repeat(900),
      org_name: "Evil",
    });
    expect(out.startsWith("{{org_name}}")).toBe(true);
    expect(out).not.toContain("\u0000");
    expect(out.length).toBeLessThanOrEqual(500);
  });
  it("renders every default template without leftover placeholders", () => {
    const vars = {
      customer_name: "A",
      org_name: "O",
      booking_number: "B",
      trip_title: "T",
      destination: "D",
      travel_start: "S",
      amount_due: "1.00",
      currency: "INR",
      due_date: "X",
      installment: "I",
      message: "M",
    };
    for (const k of TEMPLATE_KEYS) {
      expect(renderTemplate(DEFAULT_TEMPLATES[k].body, vars)).not.toMatch(/\{\{/);
      expect(renderTemplate(DEFAULT_TEMPLATES[k].subject, vars)).not.toMatch(/\{\{/);
    }
  });
});

describe("output safety", () => {
  it("escapes HTML and keeps line breaks", () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe(
      "&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;",
    );
    expect(textToHtml("a\n<b>")).toContain("a<br>&lt;b&gt;");
  });
  it("collapses subjects to one line (no header injection)", () => {
    expect(oneLine("Hello\r\nBcc: evil@x.test")).toBe("Hello Bcc: evil@x.test");
  });
  it("builds WhatsApp links only for plain digit numbers", () => {
    expect(whatsappLink("919876543210", "Hi there & more")).toBe(
      "https://wa.me/919876543210?text=Hi%20there%20%26%20more",
    );
    expect(whatsappLink("+91 98765", "x")).toBeNull();
    expect(whatsappLink("123", "x")).toBeNull();
    expect(whatsappLink("9198765432101234567", "x")).toBeNull();
  });
});

describe("portal tokens", () => {
  it("are 256-bit, URL-safe, unique, and hash to 64 hex characters", () => {
    const a = generatePortalToken();
    expect(isPortalToken(a)).toBe(true);
    expect(a).not.toBe(generatePortalToken());
    expect(hashPortalToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalToken(a)).not.toContain(a);
  });
  it("rejects malformed tokens", () => {
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!", "../".repeat(15)])
      expect(isPortalToken(bad)).toBe(false);
  });
  it("derives link state", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    expect(linkState({ expires_at: "2026-07-01T00:00:00Z", revoked_at: null }, now)).toBe("ACTIVE");
    expect(linkState({ expires_at: "2026-05-01T00:00:00Z", revoked_at: null }, now)).toBe(
      "EXPIRED",
    );
    expect(
      linkState({ expires_at: "2026-07-01T00:00:00Z", revoked_at: "2026-05-30T00:00:00Z" }, now),
    ).toBe("REVOKED");
  });
});
