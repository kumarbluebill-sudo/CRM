import type { CSSProperties } from "react";
import type { ItineraryPdfModel, ModelDay } from "@/lib/itinerary-pdf/model";
import { pdfTheme } from "@/lib/itinerary-pdf/themes";

/** A4 at 96 dpi. The preview is scaled with CSS, so this is also the size used for printing. */
export const SHEET_W = 794;
export const SHEET_H = 1123;

const amount = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const typeLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

/**
 * On-screen version of the itinerary PDF. It reads the same page model as the PDF renderer, so the pages, order, dates and
 * figures always match; spacing is an approximation, and long text can run onto an extra page in the real PDF.
 */
export function ItineraryPreview({ model: m, imageUrl }: { model: ItineraryPdfModel; imageUrl: (id: string) => string }) {
  const t = pdfTheme(m.themeKey);
  const font = t.serif ? "Georgia, 'Times New Roman', serif" : "Arial, Helvetica, sans-serif";
  const b = m.branding;
  const total = m.pages.length;
  const sheet: CSSProperties = {
    width: SHEET_W,
    height: SHEET_H,
    position: "relative",
    overflow: "hidden",
    background: "#ffffff",
    color: t.ink,
    fontFamily: font,
    fontSize: 13,
    lineHeight: 1.45,
    boxShadow: "0 1px 6px rgba(0,0,0,.18)",
  };
  const h2: CSSProperties = { fontSize: 22, color: t.primary, margin: "0 0 12px", fontWeight: 700 };
  const h3: CSSProperties = { fontSize: 14, color: t.primary, margin: "0 0 6px", fontWeight: 700 };
  const label: CSSProperties = { fontSize: 10, color: t.muted, textTransform: "uppercase", letterSpacing: 0.6 };
  const th: CSSProperties = { background: t.primary, color: t.onPrimary, padding: "6px 8px", fontSize: 12, textAlign: "left" };
  const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${t.line}` };
  const panel: CSSProperties = { background: t.tint, borderRadius: 5, padding: 12, marginBottom: 12 };

  const Logo = ({ h }: { h: number }) =>
    b.logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={b.logo} alt={b.name} style={{ height: h, maxWidth: h * 4, objectFit: "contain" }} />
    ) : (
      <span style={{ fontSize: 18, fontWeight: 700, color: t.primary }}>{b.name}</span>
    );
  const Frame = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <section style={{ ...sheet, padding: "38px 46px 70px" }} aria-label={`Page ${n} of ${total}`} data-testid="pdf-sheet">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${t.accent}`, paddingBottom: 10, marginBottom: 18 }}>
        <Logo h={83} />
        <span style={{ fontSize: 11, color: t.muted }}>{m.title}</span>
      </div>
      {children}
      <div style={{ position: "absolute", left: 46, right: 46, bottom: 24, borderTop: `1px solid ${t.line}`, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 10, color: t.muted }}>
        <span style={{ maxWidth: "75%" }}>{[b.name, b.address, b.footer].filter(Boolean).join("  ·  ")}</span>
        <span>
          Page {n} of {total}
        </span>
      </div>
    </section>
  );
  const List = ({ items, color }: { items: string[]; color?: string }) => (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((x, i) => (
        <li key={i} style={{ display: "flex", gap: 6, marginBottom: 3 }}>
          <span style={{ color: color ?? t.accent }}>•</span>
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
  const Text = ({ text }: { text: string }) => (
    <>
      {text.split("\n").filter((l) => l.trim()).map((l, i) => (
        <p key={i} style={{ margin: "0 0 7px" }}>{l.trim()}</p>
      ))}
    </>
  );
  const Day = ({ d }: { d: ModelDay }) => (
    <div style={{ border: `1px solid ${t.line}`, borderRadius: 5, marginBottom: 16, overflow: "hidden" }}>
      <div style={{ background: t.primary, color: t.onPrimary, display: "flex", alignItems: "center", gap: 10, padding: "6px 10px" }}>
        <span style={{ background: t.accent, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3 }}>DAY {d.number}</span>
        <strong style={{ flex: 1, fontSize: 14 }}>{d.title}</strong>
        <span style={{ fontSize: 11 }}>{d.date ? d.dateText : ""}</span>
      </div>
      <div style={{ display: "flex", gap: 10, padding: 10 }}>
        <div style={{ flex: 1 }}>
          {d.description && <p style={{ margin: "0 0 6px" }}>{d.description}</p>}
          {d.items.map((x, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
              <span style={{ width: 52, color: t.accent, fontWeight: 700, fontSize: 11 }}>{x.time || typeLabel(x.type)}</span>
              <span>
                <strong>{x.title}</strong>
                {x.detail && <span style={{ color: t.muted }}>{`  ${x.detail}`}</span>}
              </span>
            </div>
          ))}
        </div>
        {d.imageId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(d.imageId)} alt={`Day ${d.number}`} style={{ width: 160, height: 122, objectFit: "cover", borderRadius: 4 }} />
        )}
      </div>
    </div>
  );

  const facts = [
    ["Duration", m.durationText],
    ["Destination", m.destination],
    ["Travellers", m.travellersText],
    ["Start date", m.startDateText ?? ""],
    ["Route", m.route],
  ].filter(([, v]) => v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {m.pages.map((p, idx) => {
        const n = idx + 1;
        if (p.kind === "cover")
          return (
            <section key={idx} style={sheet} aria-label={`Page ${n} of ${total}`} data-testid="pdf-sheet">
              <div style={{ height: 506, background: t.primary }}>
                {m.coverImageId && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(m.coverImageId)} alt="Cover" style={{ width: "100%", height: 506, objectFit: "cover" }} />
                )}
              </div>
              <div style={{ height: 7, background: t.accent }} />
              <div style={{ padding: "26px 54px" }}>
                <div style={{ marginBottom: 16 }}>
                  <Logo h={113} />
                </div>
                <div style={{ fontSize: 34, color: t.primary, margin: "0 0 6px", fontWeight: 700, lineHeight: 1.15 }}>{m.title}</div>
                {m.customer && (
                  <p style={{ margin: "0 0 16px", color: t.muted, fontSize: 15 }}>
                    Specially prepared for <strong style={{ color: t.ink }}>{m.customer}</strong>
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {facts.map(([k, v]) => (
                    <div key={k} style={{ width: "47%", background: t.tint, borderRadius: 5, padding: 10 }}>
                      <div style={label}>{k}</div>
                      <strong style={{ fontSize: 14 }}>{v}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: t.primary, color: t.onPrimary, padding: "14px 54px", fontSize: 12 }}>
                <strong>{b.name}</strong>
                <div>{[b.phone, b.email, b.website].filter(Boolean).join("  |  ")}</div>
                {b.whatsapp && <div>WhatsApp: {b.whatsapp}</div>}
                <div style={{ position: "absolute", right: 54, bottom: 14, fontSize: 10 }}>
                  Page {n} of {total}
                </div>
              </div>
            </section>
          );
        if (p.kind === "overview")
          return (
            <Frame key={idx} n={n}>
              <h2 style={h2}>Trip overview</h2>
              {m.summary && <Text text={m.summary} />}
              {m.highlights.length > 0 && (
                <div style={panel}>
                  <h3 style={h3}>Trip highlights</h3>
                  <List items={m.highlights} />
                </div>
              )}
              {m.hotels.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <h3 style={h3}>Where you will stay</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th style={th}>Hotel</th><th style={th}>Details</th></tr></thead>
                    <tbody>
                      {m.hotels.map((h, i) => (
                        <tr key={i} style={{ background: i % 2 ? t.tint : undefined }}>
                          <td style={{ ...td, fontWeight: 700 }}>{h.name}</td>
                          <td style={td}>{h.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <h3 style={h3}>Date-wise summary</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={{ ...th, width: 50 }}>Day</th><th style={{ ...th, width: 140 }}>Date</th><th style={th}>Plan</th></tr></thead>
                  <tbody>
                    {m.days.map((d, i) => (
                      <tr key={d.number} style={{ background: i % 2 ? t.tint : undefined }}>
                        <td style={{ ...td, fontWeight: 700 }}>{d.number}</td>
                        <td style={td}>{d.date ? d.dateText : "—"}</td>
                        <td style={td}>{d.title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Frame>
          );
        if (p.kind === "days")
          return (
            <Frame key={idx} n={n}>
              <h2 style={h2}>Day-wise plan</h2>
              {p.days.map((d) => (
                <Day key={d.number} d={d} />
              ))}
            </Frame>
          );
        if (p.kind === "quote" && m.quote) {
          const q = m.quote;
          const row: CSSProperties = { display: "flex", justifyContent: "space-between", padding: "3px 0" };
          return (
            <Frame key={idx} n={n}>
              <h2 style={h2}>Quotation</h2>
              <p style={{ color: t.muted, margin: "0 0 10px" }}>
                {q.quotationNumber} · {q.optionName}
                {q.validUntilText ? ` · valid until ${q.validUntilText}` : ""}
              </p>
              {q.intro && <Text text={q.intro} />}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Description</th>
                    <th style={{ ...th, textAlign: "right", width: 50 }}>Qty</th>
                    <th style={{ ...th, textAlign: "right", width: 110 }}>Rate</th>
                    <th style={{ ...th, textAlign: "right", width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {q.lines.map((l, i) => (
                    <tr key={i} style={{ background: i % 2 ? t.tint : undefined }}>
                      <td style={td}>{l.description}</td>
                      <td style={{ ...td, textAlign: "right" }}>{l.quantity}</td>
                      <td style={{ ...td, textAlign: "right" }}>{amount(l.rate, q.currency)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{amount(l.amount, q.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ width: 320, marginLeft: "auto", marginTop: 14 }}>
                <div style={row}><span>Subtotal</span><span>{amount(q.subtotal, q.currency)}</span></div>
                {q.discount > 0 && <div style={row}><span>{q.discountLabel}</span><span>- {amount(q.discount, q.currency)}</span></div>}
                {q.taxRate > 0 && <div style={row}><span>GST ({q.taxRate}%)</span><span>{amount(q.tax, q.currency)}</span></div>}
                <div style={{ ...row, background: t.primary, color: t.onPrimary, padding: "7px 10px", borderRadius: 4, marginTop: 6, fontWeight: 700, fontSize: 15 }}>
                  <span>Total</span><span>{amount(q.total, q.currency)}</span>
                </div>
                {q.perPerson !== null && (
                  <div style={{ ...row, padding: "6px 10px" }}>
                    <span style={{ color: t.muted }}>Per person ({q.travellers} traveller{q.travellers === 1 ? "" : "s"})</span>
                    <strong>{amount(q.perPerson, q.currency)}</strong>
                  </div>
                )}
              </div>
            </Frame>
          );
        }
        if (p.kind === "policies")
          return (
            <Frame key={idx} n={n}>
              <h2 style={h2}>Inclusions, policies and payment</h2>
              {(m.inclusions.length > 0 || m.exclusions.length > 0) && (
                <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                  {m.inclusions.length > 0 && <div style={{ flex: 1 }}><h3 style={h3}>Included</h3><List items={m.inclusions} color="#15803d" /></div>}
                  {m.exclusions.length > 0 && <div style={{ flex: 1 }}><h3 style={h3}>Not included</h3><List items={m.exclusions} color="#b91c1c" /></div>}
                </div>
              )}
              {m.paymentTerms && <div style={{ marginBottom: 10 }}><h3 style={h3}>Payment terms</h3><Text text={m.paymentTerms} /></div>}
              {m.cancellation && <div style={{ marginBottom: 10 }}><h3 style={h3}>Cancellation policy</h3><Text text={m.cancellation} /></div>}
              {m.terms && <div style={{ marginBottom: 10 }}><h3 style={h3}>Terms and conditions</h3><Text text={m.terms} /></div>}
              {m.bank.length > 0 && (
                <div style={panel}>
                  <h3 style={h3}>Bank details</h3>
                  {m.bank.map((r) => (
                    <div key={r.label} style={{ display: "flex" }}>
                      <span style={{ width: 130, color: t.muted }}>{r.label}</span>
                      <strong>{r.value}</strong>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10 }}>
                <span style={{ color: t.muted }}>{m.validUntilText ? `This quotation is valid until ${m.validUntilText}.` : ""}</span>
                <div style={{ textAlign: "center" }}>
                  {m.signature && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.signature} alt="Signature" style={{ height: 50, maxWidth: 160, objectFit: "contain" }} />
                  )}
                  <div style={{ borderTop: `1px solid ${t.muted}`, paddingTop: 3, fontSize: 11, color: t.muted, minWidth: 170 }}>
                    Authorised signatory, {b.name}
                  </div>
                </div>
              </div>
            </Frame>
          );
        return null;
      })}
    </div>
  );
}
