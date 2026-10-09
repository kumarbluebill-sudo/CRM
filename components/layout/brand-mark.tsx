import { Plane } from "lucide-react";
import type { OrgBrand } from "@/lib/branding";

/** Agency logo (or a neutral fallback mark) and name. The name hides when the sidebar is collapsed. */
export function BrandMark({ brand }: { brand: OrgBrand }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logo}
          alt=""
          className="max-h-9 w-auto max-w-[8.5rem] shrink-0 object-contain group-data-[collapsed=true]:max-w-9"
        />
      ) : (
        <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Plane className="size-4" aria-hidden />
        </span>
      )}
      <span
        className={`min-w-0 truncate text-sm leading-tight font-semibold group-data-[collapsed=true]:hidden ${brand.logo ? "sr-only" : ""}`}
      >
        {brand.name}
      </span>
    </div>
  );
}
