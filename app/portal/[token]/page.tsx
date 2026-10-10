import { StatusBadge } from "@/components/crm/status-badge";
import { PayNow, RequestForm } from "@/components/portal/portal-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { label } from "@/lib/crm/constants";
import { getPortalView, portalPaymentsReady } from "@/lib/portal/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await getPortalView(token);

  if (!v) {
    return (
      <main id="main" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-20 text-center">
        <h1 className="text-xl font-semibold">This link isn&apos;t available</h1>
        <p className="text-muted-foreground text-sm">
          It may have expired or been replaced. Please contact your travel agent for a new link.
        </p>
      </main>
    );
  }

  const onlineEnabled = await portalPaymentsReady(token);
  const { booking: b } = v;
  const money = (n: number) => formatMoney(Number(n), b.currency);
  const accent =
    v.org.primary && /^#[0-9a-fA-F]{6}$/.test(v.org.primary) ? v.org.primary : "#0f766e";
  const canPay =
    onlineEnabled && Number(b.balance) > 0 && !["DRAFT", "CANCELLED"].includes(b.status);
  const cancelled = b.status === "CANCELLED";

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <header
        className="flex items-center justify-between gap-3 border-b-2 pb-4"
        style={{ borderColor: accent }}
      >
        {v.org.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- validated data URI from organization branding
          <img src={v.org.logo} alt={v.org.name} className="h-10 max-w-48 object-contain" />
        ) : (
          <span className="text-lg font-semibold">{v.org.name}</span>
        )}
        <span className="text-muted-foreground text-sm">Booking {b.number}</span>
      </header>

      <section aria-label="Trip" className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{b.title}</h1>
        <p className="text-muted-foreground text-sm">
          Hello {v.customer.name}. {b.destination ? `${b.destination} · ` : ""}
          {b.travelStart
            ? `${b.travelStart}${b.travelEnd ? ` to ${b.travelEnd}` : ""}`
            : "Dates to be confirmed"}
          {" · "}
          {b.adults} adult{b.adults === 1 ? "" : "s"}
          {b.children ? `, ${b.children} child${b.children === 1 ? "" : "ren"}` : ""}
        </p>
        <div>
          <StatusBadge value={b.status} />
        </div>
      </section>

      {cancelled && (
        <p
          role="note"
          className="border-tone-bad/30 bg-tone-bad-soft text-tone-bad rounded-lg border p-3 text-sm"
        >
          This booking has been cancelled. Please contact us if you have questions.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-muted-foreground text-xs">Total</dt>
              <dd className="font-medium">{money(b.total)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Paid</dt>
              <dd className="font-medium">{money(b.paid)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Balance</dt>
              <dd className="font-medium">{money(b.balance)}</dd>
            </div>
          </dl>
          {v.schedule.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {v.schedule.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 p-2.5">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground">Due {s.dueDate}</span>
                  <span className="ml-auto">{money(s.amount)}</span>
                  <StatusBadge value={s.status} />
                </li>
              ))}
            </ul>
          )}
          {v.payments.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {v.payments.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 p-2.5">
                  <span className="font-medium">{money(p.amount)}</span>
                  <span className="text-muted-foreground">
                    {label(p.method)} · {String(p.paidAt).slice(0, 10)}
                  </span>
                  <span className="text-muted-foreground ml-auto">Receipt {p.receipt}</span>
                </li>
              ))}
            </ul>
          )}
          {canPay && <PayNow token={token} balance={Number(b.balance)} currency={b.currency} />}
          {!canPay && Number(b.balance) > 0 && !cancelled && (
            <p className="text-muted-foreground">
              To pay, please contact us
              {v.org.phone ? ` on ${v.org.phone}` : ""}
              {v.org.email ? ` or ${v.org.email}` : ""}.
            </p>
          )}
          {v.invoices.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Invoice {v.invoices.map((i) => i.number).join(", ")} has been issued. Ask us if you
              need a copy.
            </p>
          )}
        </CardContent>
      </Card>

      {v.itinerary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Itinerary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {v.itinerary.map((d) => (
              <div key={d.day}>
                <h3 className="font-medium">
                  Day {d.day}
                  {d.title ? `: ${d.title}` : ""}
                </h3>
                {d.description && (
                  <p className="text-muted-foreground whitespace-pre-line">{d.description}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {v.services.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Included services</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {v.services.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 py-2">
                  <span>{s.description}</span>
                  {s.date && <span className="text-muted-foreground">{s.date}</span>}
                  <span className="text-muted-foreground ml-auto text-xs">
                    {s.confirmed ? "Confirmed" : "Being arranged"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {v.passengers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Travellers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm">
              {v.passengers.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {v.documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your documents</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {v.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <a
                    className="text-primary underline"
                    href={`/api/portal/${token}/documents/${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!cancelled && (
        <Card>
          <CardContent className="pt-4">
            <RequestForm token={token} />
          </CardContent>
        </Card>
      )}

      <footer className="text-muted-foreground text-center text-xs">
        {v.org.name}
        {v.org.phone ? ` · ${v.org.phone}` : ""}
        {v.org.email ? ` · ${v.org.email}` : ""}
      </footer>
    </main>
  );
}
