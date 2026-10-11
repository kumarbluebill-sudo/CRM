import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  allArticles,
  articleBlocks,
  loadAllArticleFiles,
  parseArticle,
  searchArticles,
  visibleArticles,
} from "@/lib/help/articles";
import { CHECKLIST } from "@/lib/help/checklist";
import {
  filterBlocks,
  parseInline,
  parseMarkdown,
  plainText,
  type Block,
} from "@/lib/help/markdown";
import { PERMISSIONS } from "@/lib/permissions";

const root = process.cwd();
const files = loadAllArticleFiles();

/** Every page route in the app, so a guide can never link to a page that does not exist. */
function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const seg = /^\(.*\)$/.test(e.name) ? "" : `/${e.name}`;
        walk(path.join(dir, e.name), rel + seg);
      } else if (e.name === "page.tsx" || e.name === "route.ts") out.push(rel || "/");
    }
  };
  walk(path.join(root, "app"), "");
  return out;
}
const toRegex = (r: string) =>
  new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\./g, "\\.")}$`);
const routeRegexes = routes().map(toRegex);
const routeExists = (href: string) => {
  const p = href.split(/[?#]/)[0].replace(/(.)\/$/, "$1");
  return routeRegexes.some((r) => r.test(p));
};

function walkBlocks(blocks: Block[], fn: (b: Block) => void) {
  for (const b of blocks) {
    fn(b);
    if (b.t === "gate") walkBlocks(b.blocks, fn);
  }
}

describe("help center content", () => {
  it("has a guide for every area, all with complete front matter", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const a of files) {
      expect(a.title, a.slug).toMatch(/\S/);
      expect(a.summary.length, a.slug).toBeGreaterThan(20);
      expect(CATEGORIES as readonly string[], a.slug).toContain(a.category);
      expect(a.keywords.length, a.slug).toBeGreaterThan(2);
      expect(a.version, a.slug).toMatch(/^\d+\.\d+\.\d+$/);
      expect(a.updated, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["published", "draft"], a.slug).toContain(a.status);
      expect(a.author, a.slug).toMatch(/\S/);
      expect(a.slug, a.slug).toMatch(/^[a-z0-9-]+$/);
    }
    const slugs = files.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const need of [
      "getting-started",
      "leads-and-customers",
      "quotations",
      "bookings",
      "payments-and-invoices",
      "visa-management",
      "staff-roles-and-access",
      "time-zones-and-formats",
      "subscription-and-billing",
      "backups-and-restore",
      "security-and-two-step-verification",
      "troubleshooting",
      "faq",
    ])
      expect(slugs, need).toContain(need);
  });

  it("only requires permissions that exist, and related guides resolve", () => {
    const slugs = new Set(files.map((f) => f.slug));
    for (const a of files) {
      if (a.requires)
        expect(PERMISSIONS as readonly string[], `${a.slug} requires`).toContain(a.requires);
      for (const r of a.related) expect(slugs.has(r), `${a.slug} -> ${r}`).toBe(true);
      walkBlocks(parseMarkdown(a.body), (b) => {
        if (b.t === "gate")
          expect(PERMISSIONS as readonly string[], `${a.slug} block ${b.perm}`).toContain(b.perm);
      });
    }
  });

  it("every image exists as a real screenshot, and every screenshot is used", () => {
    const used = new Set<string>();
    for (const a of files)
      walkBlocks(parseMarkdown(a.body), (b) => {
        if (b.t === "img") {
          used.add(b.src);
          const file = path.join(root, "public", b.src);
          expect(existsSync(file), `${a.slug}: ${b.src}`).toBe(true);
          expect(statSync(file).size, b.src).toBeGreaterThan(10_000);
          expect(b.alt.length, `${a.slug}: caption of ${b.src}`).toBeGreaterThan(10);
        }
      });
    const onDisk = readdirSync(path.join(root, "public", "guide-img"))
      .filter((f) => f.endsWith(".png"))
      .map((f) => `/guide-img/${f}`);
    for (const f of onDisk) expect(used.has(f), `unused screenshot ${f}`).toBe(true);
  });

  it("every link points at a page that exists", () => {
    for (const a of files)
      walkBlocks(parseMarkdown(a.body), (b) => {
        const inl =
          b.t === "p" || b.t === "note"
            ? b.inline
            : b.t === "ul" || b.t === "ol"
              ? b.items.flat()
              : [];
        for (const i of inl)
          if (i.t === "a" && i.href.startsWith("/"))
            expect(routeExists(i.href), `${a.slug}: ${i.href}`).toBe(true);
      });
    for (const c of CHECKLIST) {
      expect(routeExists(c.href), `checklist ${c.key}`).toBe(true);
      expect(PERMISSIONS as readonly string[], `checklist ${c.key}`).toContain(c.permission);
      expect(
        files.some((f) => f.slug === c.guide),
        `checklist guide ${c.guide}`,
      ).toBe(true);
    }
  });

  it("makes no promise the product does not keep", () => {
    const all = files.map((f) => f.body.toLowerCase()).join("\n");
    expect(all).not.toMatch(/guarantee[sd]? (?:rpo|rto|recovery)/);
    expect(all).toContain("not guarantees");
    expect(all).toMatch(/not a gst tax invoice/);
    expect(all).not.toMatch(/\b(unhackable|100% secure|military[- ]grade)\b/);
  });
});

describe("markdown rendering is safe and role-aware", () => {
  it("never turns markup or unsafe links into live content", () => {
    const blocks = parseMarkdown(
      [
        "<script>alert(1)</script> and [bad](javascript:alert(1)) and [also bad](//evil.example/x)",
        "",
        "![x](https://evil.example/a.png)",
        "![y](/guide-img/../secret.png)",
        "",
        "[ok](https://example.com/path) and [local](/help/faq)",
      ].join("\n"),
    );
    const inline = blocks.flatMap((b) => (b.t === "p" ? b.inline : []));
    expect(inline.filter((i) => i.t === "a").map((i) => (i as { href: string }).href)).toEqual([
      "https://example.com/path",
      "/help/faq",
    ]);
    expect(blocks.some((b) => b.t === "img")).toBe(false);
    // the script tag stays inert text: the renderer only ever emits typed nodes
    expect(JSON.stringify(blocks)).toContain("<script>");
    expect(blocks.every((b) => ["p", "h", "ul", "ol", "note", "img", "gate"].includes(b.t))).toBe(
      true,
    );
  });

  it("reads emphasis in either style without touching snake_case or arithmetic", () => {
    const inl = (s: string) => parseInline(s).map((i) => `${i.t}:${i.v}`);
    expect(inl("a *b* c")).toEqual(["text:a ", "i:b", "text: c"]);
    expect(inl("a _b_ c")).toEqual(["text:a ", "i:b", "text: c"]);
    expect(inl("snake_case_name and 2*3*4")).toEqual(["text:snake_case_name and 2*3*4"]);
    expect(inl("**bold** and `code_x`")).toEqual(["b:bold", "text: and ", "code:code_x"]);
  });

  it("shows permission blocks only to people who hold the permission", () => {
    const blocks = parseMarkdown(
      "Everyone sees this.\n\n:::requires billing.manage\nOnly billing.\n:::\n\n:::admin\nOnly settings.\n:::\n\nAnd this.",
    );
    const text = (has: (p: string) => boolean) => plainText(filterBlocks(blocks, has));
    expect(text(() => false)).toBe("Everyone sees this. And this.");
    expect(text((p) => p === "billing.manage")).toContain("Only billing.");
    expect(text((p) => p === "billing.manage")).not.toContain("Only settings.");
    expect(text((p) => p === "settings.manage")).toContain("Only settings.");
    // an unclosed block still ends safely, and is still gated
    expect(plainText(filterBlocks(parseMarkdown(":::admin\nsecret"), () => false))).toBe("");
  });

  it("hides whole guides from roles that cannot use the feature", () => {
    const nothing = visibleArticles(() => false).map((a) => a.slug);
    expect(nothing).toContain("getting-started");
    expect(nothing).toContain("faq");
    expect(nothing).not.toContain("backups-and-restore");
    expect(nothing).not.toContain("staff-roles-and-access");
    const backup = visibleArticles((p) => p === "backup.manage").map((a) => a.slug);
    expect(backup).toContain("backups-and-restore");
    expect(backup).not.toContain("subscription-and-billing");
  });

  it("front matter parsing handles lists, quotes and missing fields", () => {
    const a = parseArticle(
      "x",
      '---\ntitle: "Hello"\nkeywords: [a, b , c]\nrequires:\nstatus: draft\n---\nbody',
    );
    expect(a.title).toBe("Hello");
    expect(a.keywords).toEqual(["a", "b", "c"]);
    expect(a.requires).toBeNull();
    expect(a.status).toBe("draft");
    expect(() => parseArticle("y", "no front matter")).toThrow();
  });
});

describe("help search", () => {
  const list = allArticles();
  it("finds guides by title, keyword and text, best match first", () => {
    expect(searchArticles(list, "backup")[0].slug).toBe("backups-and-restore");
    expect(searchArticles(list, "time zone")[0].slug).toBe("time-zones-and-formats");
    expect(searchArticles(list, "credit note").map((a) => a.slug)).toContain(
      "payments-and-invoices",
    );
    expect(searchArticles(list, "grace period").map((a) => a.slug)).toContain(
      "subscription-and-billing",
    );
  });
  it("needs every word, ignores one-letter noise, and returns nothing for gibberish", () => {
    expect(searchArticles(list, "zzzzqqq")).toEqual([]);
    expect(searchArticles(list, "backup zzzzqqq")).toEqual([]);
    expect(searchArticles(list, "a")).toEqual([]);
    expect(searchArticles(list, "")).toEqual([]);
  });
  it("only searches what the reader may see", () => {
    const visible = visibleArticles(() => false);
    expect(searchArticles(visible, "restore plan").map((a) => a.slug)).not.toContain(
      "backups-and-restore",
    );
  });
  it("parses every guide into blocks", () => {
    for (const a of list) expect(articleBlocks(a).length, a.slug).toBeGreaterThan(2);
  });
});
