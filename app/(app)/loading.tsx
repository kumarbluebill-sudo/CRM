import { Skeleton } from "@/components/ui/skeleton";

/** Shown inside the app shell while a page loads, so the sidebar and header stay in place. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading page">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
