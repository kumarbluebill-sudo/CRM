/**
 * A deliberately small Markdown subset for the help articles. It produces a typed tree (never HTML), so a page or a PDF
 * renders it with ordinary components and nothing in an article can inject markup or script.
 *
 * Supported: # ## ### headings, paragraphs, - lists, 1. lists, > notes, ![caption](/guide-img/file.png) images (the alt text
 * is shown as the caption), **bold**, `code`, [text](/path or https://...) links, and permission blocks:
 *
 *   :::requires settings.manage      shown only to people who hold that permission
 *   ...
 *   :::
 *   :::admin                         shorthand for "requires settings.manage"
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "i"; v: string }
  | { t: "code"; v: string }
  | { t: "a"; href: string; v: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; id: string; text: string }
  | { t: "p"; inline: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "note"; inline: Inline[] }
  | { t: "img"; alt: string; src: string }
  | { t: "gate"; perm: string; blocks: Block[] };

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const safeHref = (h: string) =>
  /^\/(?!\/)[^\s\\]*$/.test(h) || /^https:\/\/[^\s]+$/.test(h) ? h : null;
const safeImg = (h: string) =>
  /^\/guide-img\/[A-Za-z0-9._-]+\.(png|jpg|webp)$/.test(h) && !h.includes("..") ? h : null;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re =
    /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<!\w)_([^_\s][^_]*)_(?!\w)/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ t: "i", v: (m[5] ?? m[6])! });
    else {
      const href = safeHref(m[4]);
      out.push(href ? { t: "a", href, v: m[3] } : { t: "text", v: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const root: Block[] = [];
  let target = root;
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: Inline[][] } | null = null;
  let gate: Extract<Block, { t: "gate" }> | null = null;
  const flushPara = () => {
    if (para.length) target.push({ t: "p", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) target.push({ t: list.kind, items: list.items });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const g = /^:::\s*(\w+)?\s*([\w.]+)?$/.exec(line);
    if (g) {
      flushPara();
      flushList();
      if (gate) {
        root.push(gate);
        gate = null;
        target = root;
      } else if (g[1] === "requires" || g[1] === "admin") {
        gate = {
          t: "gate",
          perm: g[1] === "admin" ? "settings.manage" : (g[2] ?? ""),
          blocks: [],
        };
        target = gate.blocks;
      }
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.+)$/.exec(line))) {
      flushPara();
      flushList();
      target.push({ t: "h", level: m[1].length as 1 | 2 | 3, id: slugify(m[2]), text: m[2] });
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line))) {
      flushPara();
      flushList();
      const src = safeImg(m[2]);
      if (src) target.push({ t: "img", alt: m[1], src });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      target.push({ t: "note", inline: parseInline(m[1]) });
    } else if ((m = /^[-*]\s+(.+)$/.exec(line))) {
      flushPara();
      if (list?.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(parseInline(m[1]));
    } else if ((m = /^\d+\.\s+(.+)$/.exec(line))) {
      flushPara();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(parseInline(m[1]));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  if (gate) root.push(gate); // an unclosed block still ends the document safely
  return root;
}

/** Drops permission blocks the viewer does not hold the permission for. */
export function filterBlocks(blocks: Block[], has: (permission: string) => boolean): Block[] {
  return blocks.flatMap((b) =>
    b.t === "gate" ? (has(b.perm) ? filterBlocks(b.blocks, has) : []) : [b],
  );
}

export function plainText(blocks: Block[]): string {
  const inl = (i: Inline[]) => i.map((x) => x.v).join("");
  return blocks
    .map((b) => {
      switch (b.t) {
        case "h":
          return b.text;
        case "p":
        case "note":
          return inl(b.inline);
        case "ul":
        case "ol":
          return b.items.map(inl).join(" ");
        case "img":
          return b.alt;
        case "gate":
          return plainText(b.blocks);
      }
    })
    .join(" ");
}
