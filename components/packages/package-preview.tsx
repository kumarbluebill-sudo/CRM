import { readableOn } from "@/lib/packages/templates";
import type { PackageDocument } from "@/lib/packages/document";

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
};
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

function Photo({ id, className, alt }: { id: string; className?: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/package-images/${id}`} alt={alt} loading="lazy" className={className} />;
}

/** On-screen version of the brochure, using the same data and theme as the PDF. Prints cleanly. */
export function PackagePreview({ doc }: { doc: PackageDocument }) {
  const { primary, secondary, accent, font, layout } = doc.theme;
  const serif = font === "SERIF";
  const onPrimary = readableOn(primary);
  const facts = [
    ["Duration", doc.durationText],
    ["Departure", fmtDate(doc.startDate)],
    ["Return", fmtDate(doc.returnDate)],
    ["Travellers", doc.travellers],
    ["Hotels", doc.hotelCategory ?? ""],
  ].filter(([, v]) => v);

  const Cover =
    layout === "MAGAZINE" ? (
      <header className="relative overflow-hidden rounded-xl" style={{ background: secondary }}>
        {doc.coverId ? (
          <Photo id={doc.coverId} alt={`${doc.title} cover`} className="h-80 w-full object-cover" />
        ) : (
          <div className="h-80" />
        )}
        <div
          className="absolute inset-x-0 bottom-0 p-6 text-white"
          style={{ background: `${primary}d1` }}
        >
          <h1 className="text-3xl leading-tight font-bold">{doc.title}</h1>
          <p className="text-lg">{doc.destination}</p>
          <p className="text-sm opacity-90">{doc.durationText}</p>
        </div>
      </header>
    ) : layout === "MODERN" ? (
      <header className="flex overflow-hidden rounded-xl border">
        <div className="w-4 shrink-0" style={{ background: primary }} />
        <div className="flex-1 p-5">
          <h1 className="text-3xl font-bold" style={{ color: primary }}>
            {doc.title}
          </h1>
          <p className="text-lg" style={{ color: secondary }}>
            {doc.destination}
          </p>
          <p className="text-muted-foreground text-sm">{doc.durationText}</p>
          {doc.coverId ? (
            <Photo
              id={doc.coverId}
              alt={`${doc.title} cover`}
              className="mt-4 h-64 w-full rounded-lg object-cover"
            />
          ) : (
            <div className="mt-4 h-40 rounded-lg" style={{ background: secondary }} aria-hidden />
          )}
        </div>
      </header>
    ) : (
      <header className="rounded-xl border-2 p-5 text-center" style={{ borderColor: secondary }}>
        <p className="text-xs tracking-[0.25em]" style={{ color: secondary }}>
          {doc.templateName.toUpperCase()}
        </p>
        <h1 className="mt-2 text-4xl font-bold" style={{ color: primary }}>
          {doc.title}
        </h1>
        <p className="text-lg" style={{ color: secondary }}>
          {doc.destination}
        </p>
        <p className="text-muted-foreground text-sm">{doc.durationText}</p>
        {doc.coverId ? (
          <Photo
            id={doc.coverId}
            alt={`${doc.title} cover`}
            className="mt-4 h-72 w-full object-cover"
          />
        ) : (
          <div className="mt-4 h-40" style={{ background: secondary }} aria-hidden />
        )}
      </header>
    );

  return (
    <article
      className="bg-card mx-auto flex max-w-3xl flex-col gap-6 rounded-xl border p-5 print:border-0 print:p-0"
      style={{ fontFamily: serif ? "Georgia, 'Times New Roman', serif" : undefined }}
    >
      {doc.draft && (
        <p className="text-xs font-semibold text-tone-bad print:hidden">DRAFT: not published</p>
      )}
      <div className="flex items-center justify-between gap-3">
        {doc.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.logo} alt={doc.contact.name} className="max-h-10 w-auto object-contain" />
        ) : (
          <span className="text-lg font-semibold" style={{ color: primary }}>
            {doc.contact.name}
          </span>
        )}
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold"
          style={{ background: accent, color: readableOn(accent) }}
        >
          {doc.templateName.toUpperCase()}
        </span>
      </div>
      {Cover}
      <p className="text-center text-sm text-tone-neutral italic">{doc.tagline}</p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="rounded-lg border p-2">
            <dt className="text-[10px] text-tone-neutral uppercase">{k}</dt>
            <dd className="text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {doc.price.amount != null && (
        <div className="rounded-lg p-4" style={{ background: primary, color: onPrimary }}>
          <p className="text-xs opacity-90">PACKAGE PRICE</p>
          <p className="text-2xl font-bold">
            {money(doc.price.amount, doc.price.currency)}{" "}
            <span className="text-sm font-normal">{doc.price.note ?? "per person"}</span>
          </p>
          {(doc.price.child != null || doc.price.extra != null) && (
            <p className="text-xs opacity-90">
              {doc.price.child != null ? `Child ${money(doc.price.child, doc.price.currency)}` : ""}
              {doc.price.child != null && doc.price.extra != null ? " · " : ""}
              {doc.price.extra != null
                ? `Extra person ${money(doc.price.extra, doc.price.currency)}`
                : ""}
            </p>
          )}
        </div>
      )}

      {doc.summary && (
        <section>
          <h2 className="mb-1 text-xl font-bold" style={{ color: primary }}>
            Overview
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-line">{doc.summary}</p>
        </section>
      )}
      {doc.galleryIds.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {doc.galleryIds.slice(0, 3).map((id) => (
            <Photo
              key={id}
              id={id}
              alt="Destination"
              className="h-28 w-full rounded object-cover"
            />
          ))}
        </div>
      )}

      {(
        [
          ["Accommodation", doc.accommodation],
          ["Transport and transfers", doc.transport],
          ["Flights", doc.flights],
          ["Meals", doc.meals],
          ["Sightseeing and activities", doc.activities],
        ] as [string, string | null][]
      ).some(([, v]) => v) && (
        <section>
          <h2 className="mb-1 text-xl font-bold" style={{ color: primary }}>
            Stay, travel and experiences
          </h2>
          {(
            [
              ["Accommodation", doc.accommodation],
              ["Transport and transfers", doc.transport],
              ["Flights", doc.flights],
              ["Meals", doc.meals],
              ["Sightseeing and activities", doc.activities],
            ] as [string, string | null][]
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="mb-2">
                <h3 className="text-sm font-semibold" style={{ color: secondary }}>
                  {k}
                </h3>
                <p className="text-sm whitespace-pre-line">{v}</p>
              </div>
            ))}
          {doc.hotelIds.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {doc.hotelIds.slice(0, 3).map((id) => (
                <Photo key={id} id={id} alt="Hotel" className="h-24 w-full rounded object-cover" />
              ))}
            </div>
          )}
        </section>
      )}

      {doc.days.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl font-bold" style={{ color: primary }}>
            Day-by-day itinerary
          </h2>
          <ol className="flex flex-col gap-3">
            {doc.days.map((d) => (
              <li key={d.number} className="flex break-inside-avoid gap-3">
                <span
                  className="flex size-11 shrink-0 flex-col items-center justify-center rounded-full text-center leading-none"
                  style={{ background: primary, color: onPrimary }}
                >
                  <span className="text-[8px]">DAY</span>
                  <span className="text-base font-bold">{d.number}</span>
                </span>
                <div className="flex-1">
                  <h3 className="font-semibold" style={{ color: secondary }}>
                    {d.title}
                  </h3>
                  {d.date && <p className="text-xs text-tone-neutral">{fmtDate(d.date)}</p>}
                  {d.description && (
                    <p className="mt-0.5 text-sm whitespace-pre-line">{d.description}</p>
                  )}
                  {d.items.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-sm text-tone-neutral">
                      {d.items.map((it, i) => (
                        <li key={i}>
                          {it.time && <span className="text-tone-neutral">{it.time} </span>}
                          <strong>{it.title}</strong>
                          {it.description ? ` - ${it.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.imageIds.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {d.imageIds.slice(0, 2).map((id) => (
                        <Photo
                          key={id}
                          id={id}
                          alt={`Day ${d.number}`}
                          className="h-24 w-full rounded object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(doc.inclusions.length > 0 || doc.exclusions.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {doc.inclusions.length > 0 && (
            <div className="rounded-lg border p-3">
              <h3 className="text-sm font-semibold" style={{ color: secondary }}>
                Included
              </h3>
              <ul className="mt-1 text-sm">
                {doc.inclusions.map((t, i) => (
                  <li key={i}>+ {t}</li>
                ))}
              </ul>
            </div>
          )}
          {doc.exclusions.length > 0 && (
            <div className="rounded-lg border p-3">
              <h3 className="text-sm font-semibold" style={{ color: secondary }}>
                Not included
              </h3>
              <ul className="mt-1 text-sm">
                {doc.exclusions.map((t, i) => (
                  <li key={i}>- {t}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {doc.cancellationPolicy && (
        <section>
          <h2 className="mb-1 text-xl font-bold" style={{ color: primary }}>
            Cancellation policy
          </h2>
          <p className="text-sm whitespace-pre-line">{doc.cancellationPolicy}</p>
        </section>
      )}
      {doc.terms && (
        <section>
          <h2 className="mb-1 text-xl font-bold" style={{ color: primary }}>
            Terms and conditions
          </h2>
          <p className="text-xs whitespace-pre-line">{doc.terms}</p>
        </section>
      )}
      {doc.travelNotes && (
        <section>
          <h2 className="mb-1 text-xl font-bold" style={{ color: primary }}>
            Important travel notes
          </h2>
          <p className="text-sm whitespace-pre-line">{doc.travelNotes}</p>
        </section>
      )}

      <footer className="rounded-lg p-4" style={{ background: primary, color: onPrimary }}>
        <p className="text-lg font-bold">{doc.cta}</p>
        <p className="mt-1 text-sm">
          {[
            doc.contact.name,
            doc.contact.phone,
            doc.contact.whatsapp ? `WhatsApp ${doc.contact.whatsapp}` : null,
            doc.contact.email,
            doc.contact.website,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        {doc.contact.address && <p className="mt-0.5 text-xs">{doc.contact.address}</p>}
      </footer>
    </article>
  );
}
