import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseMarkdown, plainText, type Block } from "./markdown";

export const CATEGORIES = [
  "Getting started",
  "Sales",
  "Travel and bookings",
  "Visa",
  "Finance",
  "Team and access",
  "Account and billing",
  "Security and data",
  "Troubleshooting",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Article = {
  slug: string;
  title: string;
  summary: string;
  category: Category;
  keywords: string[];
  /** Permission needed to see this guide at all; null means everyone signed in. */
  requires: string | null;
  version: string;
  updated: string;
  status: "published" | "draft";
  related: string[];
  author: string;
  body: string;
};

const dir = () => path.join(process.cwd(), "content", "help");

/** key: value lines between two --- lines; [a, b] is a list. */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const text = raw.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("missing front matter");
  const meta: Record<string, string | string[]> = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    // a list may start on the next line and span several lines (formatters wrap long ones)
    if (!v && /^\s+\[/.test(lines[i + 1] ?? "")) v = lines[++i].trim();
    while (v.startsWith("[") && !v.includes("]") && i + 1 < lines.length)
      v += " " + lines[++i].trim();
    meta[kv[1]] =
      v.startsWith("[") && v.endsWith("]")
        ? v
            .slice(1, -1)
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : v.replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: m[2] };
}

export function parseArticle(slug: string, raw: string): Article {
  const { meta, body } = parseFrontmatter(raw);
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : "");
  const list = (k: string) => (Array.isArray(meta[k]) ? (meta[k] as string[]) : []);
  return {
    slug,
    title: str("title"),
    summary: str("summary"),
    category: str("category") as Category,
    keywords: list("keywords"),
    requires: str("requires") || null,
    version: str("version"),
    updated: str("updated"),
    status: (str("status") || "published") as Article["status"],
    related: list("related"),
    author: str("author"),
    body,
  };
}

/** Every article file, drafts included (the tests check all of them). */
export function loadAllArticleFiles(): Article[] {
  return readdirSync(dir())
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseArticle(f.replace(/\.md$/, ""), readFileSync(path.join(dir(), f), "utf8")));
}

let cache: Article[] | undefined;
/** Every published article, in category then title order. Read once per server process. */
export function allArticles(): Article[] {
  if (!cache) {
    cache = loadAllArticleFiles()
      .filter((a) => a.status === "published")
      .sort(
        (a, b) =>
          CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
          a.title.localeCompare(b.title),
      );
  }
  return cache;
}

export const getArticle = (slug: string) =>
  /^[a-z0-9-]+$/.test(slug) ? allArticles().find((a) => a.slug === slug) : undefined;

export const visibleArticles = (has: (permission: string) => boolean) =>
  allArticles().filter((a) => !a.requires || has(a.requires));

const blocksCache = new Map<string, Block[]>();
export function articleBlocks(a: Article): Block[] {
  let b = blocksCache.get(a.slug);
  if (!b) blocksCache.set(a.slug, (b = parseMarkdown(a.body)));
  return b;
}

/** Ranked search over titles, keywords, summaries and text. Every word must match somewhere. */
export function searchArticles(list: Article[], query: string): Article[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6);
  if (!words.length) return [];
  return list
    .map((a) => {
      const title = a.title.toLowerCase();
      const kw = a.keywords.join(" ").toLowerCase();
      const sum = a.summary.toLowerCase();
      const text = plainText(articleBlocks(a)).toLowerCase();
      let score = 0;
      for (const w of words) {
        const s =
          (title.includes(w) ? 10 : 0) +
          (kw.includes(w) ? 6 : 0) +
          (sum.includes(w) ? 3 : 0) +
          (text.includes(w) ? 1 : 0);
        if (!s) return { a, score: 0 };
        score += s;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
