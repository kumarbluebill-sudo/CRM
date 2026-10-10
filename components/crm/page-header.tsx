export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Optional trail above the title, e.g. [{ label: "Leads", href: "/leads" }, { label: "Goa trip" }]. */
  breadcrumb?: { label: string; href?: string }[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="text-muted-foreground mb-1 text-xs">
            {breadcrumb.map((b, i) => (
              <span key={b.label}>
                {i > 0 && <span aria-hidden> / </span>}
                {b.href ? (
                  <a href={b.href} className="hover:text-foreground hover:underline">
                    {b.label}
                  </a>
                ) : (
                  <span aria-current="page">{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
