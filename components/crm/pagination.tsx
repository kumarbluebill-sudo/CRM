import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE } from "@/lib/crm/constants";

export function Pagination({
  page,
  total,
  basePath,
  params,
}: {
  page: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between pt-2 text-sm">
      <span className="text-muted-foreground">
        {total === 0
          ? "0"
          : `${(Math.min(page, pages) - 1) * PAGE_SIZE + 1}–${Math.min(Math.min(page, pages) * PAGE_SIZE, total)}`}{" "}
        of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            nativeButton={false}
            render={<Link href={href(page - 1)} />}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
        )}
        {page < pages ? (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            nativeButton={false}
            render={<Link href={href(page + 1)} />}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}
