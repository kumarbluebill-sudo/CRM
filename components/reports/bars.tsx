/** Horizontal bars in plain HTML/CSS: no chart library, readable by screen readers as a list. */
export function Bars({
  rows,
  tone = "primary",
}: {
  rows: { label: string; value: number; text: string }[];
  tone?: "primary" | "warn";
}) {
  if (rows.length === 0)
    return <p className="text-muted-foreground text-sm">No data in this range.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="flex flex-col gap-1">
          <div className="flex justify-between gap-2">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="text-muted-foreground shrink-0">{r.text}</span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className={tone === "warn" ? "h-full bg-tone-warn" : "bg-primary h-full"}
              style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
