import Image from "next/image";
import Link from "next/link";
import { Info } from "lucide-react";
import type { Block, Inline } from "@/lib/help/markdown";

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, n) => {
        switch (i.t) {
          case "b":
            return <strong key={n}>{i.v}</strong>;
          case "i":
            return <em key={n}>{i.v}</em>;
          case "code":
            return (
              <code key={n} className="bg-muted rounded px-1 py-0.5 text-[0.85em]">
                {i.v}
              </code>
            );
          case "a":
            return i.href.startsWith("/") ? (
              <Link key={n} href={i.href} className="text-primary underline underline-offset-2">
                {i.v}
              </Link>
            ) : (
              <a
                key={n}
                href={i.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {i.v}
              </a>
            );
          default:
            return <span key={n}>{i.v}</span>;
        }
      })}
    </>
  );
}

/** Renders a parsed (and already permission-filtered) article. Only typed nodes are rendered, never raw HTML. */
export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      {blocks.map((b, n) => {
        switch (b.t) {
          case "h": {
            const cls =
              b.level === 1
                ? "text-xl font-semibold"
                : b.level === 2
                  ? "mt-3 text-base font-semibold"
                  : "mt-2 text-sm font-semibold";
            return b.level === 3 ? (
              <h4 key={n} id={b.id} className={cls}>
                {b.text}
              </h4>
            ) : (
              <h3 key={n} id={b.id} className={cls}>
                {b.text}
              </h3>
            );
          }
          case "p":
            return (
              <p key={n}>
                <Inlines items={b.inline} />
              </p>
            );
          case "ul":
            return (
              <ul key={n} className="list-disc space-y-1 pl-5">
                {b.items.map((it, i) => (
                  <li key={i}>
                    <Inlines items={it} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={n} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, i) => (
                  <li key={i}>
                    <Inlines items={it} />
                  </li>
                ))}
              </ol>
            );
          case "note":
            return (
              <p
                key={n}
                role="note"
                className="border-tone-info/30 bg-tone-info-soft text-foreground flex gap-2 rounded-lg border p-3"
              >
                <Info className="text-tone-info mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <Inlines items={b.inline} />
                </span>
              </p>
            );
          case "img":
            return (
              <figure key={n} className="flex flex-col gap-1">
                <Image
                  src={b.src}
                  alt={b.alt}
                  width={1280}
                  height={720}
                  className="h-auto w-full rounded-lg border"
                />
                <figcaption className="text-muted-foreground text-xs">{b.alt}</figcaption>
              </figure>
            );
          default:
            return null; // gates are resolved before rendering
        }
      })}
    </div>
  );
}
