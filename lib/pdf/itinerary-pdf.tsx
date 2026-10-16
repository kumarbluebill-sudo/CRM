/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop (PDF output, not HTML) */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ItineraryPdfModel, ModelDay } from "@/lib/itinerary-pdf/model";
import { pdfTheme } from "@/lib/itinerary-pdf/themes";

// The built-in PDF fonts have no rupee sign, so amounts use the currency code (INR 42,500).
export const pdfAmount = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const MM = 2.8346; // points per millimetre
const typeLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

/**
 * The customer itinerary: A4, a logo and company footer with "Page X of Y" on every page.
 * `images` maps a photo id to a data URI read server-side from private storage; a missing photo becomes a coloured block.
 * The model carries selling prices only, so nothing here can print a cost or a markup.
 */
export function ItineraryPdf({
  model: m,
  images,
}: {
  model: ItineraryPdfModel;
  images: Record<string, string>;
}) {
  const t = pdfTheme(m.themeKey);
  const base = t.serif ? "Times-Roman" : "Helvetica";
  const bold = t.serif ? "Times-Bold" : "Helvetica-Bold";
  const heading = t.serif ? "Times-Bold" : "Helvetica-Bold";
  const s = StyleSheet.create({
    page: { paddingTop: 30, paddingHorizontal: 36, paddingBottom: 56, fontSize: 9.5, fontFamily: base, color: t.ink },
    coverPage: { padding: 0, fontSize: 9.5, fontFamily: base, color: t.ink },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottomWidth: 1.2, borderBottomColor: t.accent },
    headTitle: { fontSize: 8.5, color: t.muted, textAlign: "right" },
    h2: { fontFamily: heading, fontSize: 16, color: t.primary, marginBottom: 8 },
    h3: { fontFamily: bold, fontSize: 10.5, color: t.primary, marginBottom: 3 },
    label: { fontSize: 7.5, color: t.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
    muted: { color: t.muted },
    p: { lineHeight: 1.45, marginBottom: 6 },
    panel: { backgroundColor: t.tint, borderRadius: 4, padding: 10, marginBottom: 10 },
    th: { flexDirection: "row", backgroundColor: t.primary, paddingVertical: 5, paddingHorizontal: 6 },
    thText: { color: t.onPrimary, fontFamily: bold, fontSize: 8.5 },
    tr: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.6, borderBottomColor: t.line },
    trAlt: { backgroundColor: t.tint },
    day: { marginBottom: 12, borderWidth: 0.8, borderColor: t.line, borderRadius: 4 },
    dayBar: { flexDirection: "row", alignItems: "center", backgroundColor: t.primary, paddingVertical: 5, paddingHorizontal: 8, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    dayBadge: { backgroundColor: t.accent, color: "#ffffff", fontFamily: bold, fontSize: 8, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 2, marginRight: 8 },
    dayTitle: { color: t.onPrimary, fontFamily: bold, fontSize: 10.5, flexGrow: 1 },
    dayDate: { color: t.onPrimary, fontSize: 8.5 },
    footer: { position: "absolute", bottom: 20, left: 36, right: 36, paddingTop: 6, borderTopWidth: 0.6, borderTopColor: t.line, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: t.muted },
    bullet: { flexDirection: "row", marginBottom: 2.5 },
  });

  const b = m.branding;
  const img = (id: string | null | undefined) => (id ? images[id] : undefined);
  const contact = [b.phone, b.email, b.website].filter(Boolean).join("  |  ");
  const Logo = ({ h }: { h: number }) =>
    b.logo ? <Image src={b.logo} style={{ height: h, maxWidth: h * 4, objectFit: "contain" }} /> : (
      <Text style={{ fontFamily: heading, fontSize: 14, color: t.primary }}>{b.name}</Text>
    );

  const Footer = () => (
    <View style={s.footer} fixed>
      <Text style={{ maxWidth: "70%" }}>{[b.name, b.address, b.footer].filter(Boolean).join("  ·  ")}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
  const Head = ({ title }: { title: string }) => (
    <View style={s.head} fixed>
      <Logo h={22 * MM} />
      <Text style={s.headTitle}>{title}</Text>
    </View>
  );
  const Bullets = ({ items, color }: { items: string[]; color?: string }) => (
    <View>
      {items.map((x, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={{ width: 10, color: color ?? t.accent }}>•</Text>
          <Text style={{ flex: 1, lineHeight: 1.4 }}>{x}</Text>
        </View>
      ))}
    </View>
  );
  const Para = ({ text }: { text: string }) => (
    <View>
      {text.split("\n").filter((l) => l.trim()).map((l, i) => (
        <Text key={i} style={s.p}>{l.trim()}</Text>
      ))}
    </View>
  );

  const DayBlock = ({ d }: { d: ModelDay }) => {
    const photo = img(d.imageId);
    return (
      <View style={s.day} wrap={false}>
        <View style={s.dayBar}>
          <Text style={s.dayBadge}>DAY {d.number}</Text>
          <Text style={s.dayTitle}>{d.title}</Text>
          <Text style={s.dayDate}>{d.date ? d.dateText : ""}</Text>
        </View>
        <View style={{ flexDirection: "row", padding: 8, gap: 8 }}>
          <View style={{ flex: 1 }}>
            {d.description ? <Text style={[s.p, { marginBottom: 4 }]}>{d.description}</Text> : null}
            {d.items.map((x, i) => (
              <View key={i} style={{ flexDirection: "row", marginBottom: 2.5 }}>
                <Text style={{ width: 38, color: t.accent, fontFamily: bold, fontSize: 8.5 }}>{x.time || typeLabel(x.type)}</Text>
                <Text style={{ flex: 1, lineHeight: 1.35 }}>
                  <Text style={{ fontFamily: bold }}>{x.title}</Text>
                  {x.detail ? <Text style={s.muted}>{`  ${x.detail}`}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
          {photo ? <Image src={photo} style={{ width: 120, height: 92, objectFit: "cover", borderRadius: 3 }} /> : null}
        </View>
      </View>
    );
  };

  const cover = img(m.coverImageId);
  const facts: { label: string; value: string }[] = [
    { label: "Duration", value: m.durationText },
    { label: "Destination", value: m.destination },
    { label: "Travellers", value: m.travellersText },
    { label: "Start date", value: m.startDateText ?? "" },
    { label: "Route", value: m.route },
  ].filter((f) => f.value);

  return (
    <Document title={m.title} author={b.name} creator={b.name}>
      {m.pages.map((p, idx) => {
        if (p.kind === "cover")
          return (
            <Page key={idx} size="A4" style={s.coverPage}>
              <View style={{ height: 380, backgroundColor: t.primary }}>
                {cover ? <Image src={cover} style={{ width: "100%", height: 380, objectFit: "cover" }} /> : null}
              </View>
              <View style={{ backgroundColor: t.accent, height: 5 }} />
              <View style={{ paddingHorizontal: 40, paddingTop: 22 }}>
                <View style={{ marginBottom: 14 }}>
                  <Logo h={30 * MM} />
                </View>
                <Text style={{ fontFamily: heading, fontSize: 26, color: t.primary, marginBottom: 5 }}>{m.title}</Text>
                {m.customer ? (
                  <Text style={{ fontSize: 11.5, color: t.muted, marginBottom: 14 }}>
                    Specially prepared for <Text style={{ fontFamily: bold, color: t.ink }}>{m.customer}</Text>
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {facts.map((f) => (
                    <View key={f.label} style={{ width: "47%", backgroundColor: t.tint, borderRadius: 4, padding: 8 }}>
                      <Text style={s.label}>{f.label}</Text>
                      <Text style={{ fontFamily: bold, fontSize: 10.5 }}>{f.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: t.primary, paddingVertical: 12, paddingHorizontal: 40 }}>
                <Text style={{ color: t.onPrimary, fontFamily: bold, fontSize: 10 }}>{b.name}</Text>
                <Text style={{ color: t.onPrimary, fontSize: 8.5, marginTop: 2 }}>{contact}</Text>
                {b.whatsapp ? <Text style={{ color: t.onPrimary, fontSize: 8.5 }}>WhatsApp: {b.whatsapp}</Text> : null}
                <Text
                  style={{ position: "absolute", right: 40, bottom: 12, color: t.onPrimary, fontSize: 7.5 }}
                  render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
                />
                {b.footer ? <Text style={{ color: t.onPrimary, fontSize: 7.5, marginTop: 4 }}>{b.footer}</Text> : null}
              </View>
            </Page>
          );

        if (p.kind === "overview")
          return (
            <Page key={idx} size="A4" style={s.page}>
              <Head title={m.title} />
              <Footer />
              <Text style={s.h2}>Trip overview</Text>
              {m.summary ? <Para text={m.summary} /> : null}
              {m.highlights.length > 0 && (
                <View style={s.panel} wrap={false}>
                  <Text style={s.h3}>Trip highlights</Text>
                  <Bullets items={m.highlights} />
                </View>
              )}
              {m.hotels.length > 0 && (
                <View style={{ marginBottom: 12 }} wrap={false}>
                  <Text style={s.h3}>Where you will stay</Text>
                  <View style={s.th}>
                    <Text style={[s.thText, { flex: 2 }]}>Hotel</Text>
                    <Text style={[s.thText, { flex: 3 }]}>Details</Text>
                  </View>
                  {m.hotels.map((h, i) => (
                    <View key={i} style={[s.tr, i % 2 ? s.trAlt : {}]}>
                      <Text style={{ flex: 2, fontFamily: bold }}>{h.name}</Text>
                      <Text style={{ flex: 3 }}>{h.detail}</Text>
                    </View>
                  ))}
                </View>
              )}
              {(m.transport || m.flights || m.meals) && (
                <View style={s.panel} wrap={false}>
                  {m.flights ? (<View style={{ marginBottom: 4 }}><Text style={s.label}>Flights</Text><Text>{m.flights}</Text></View>) : null}
                  {m.transport ? (<View style={{ marginBottom: 4 }}><Text style={s.label}>Transport</Text><Text>{m.transport}</Text></View>) : null}
                  {m.meals ? (<View><Text style={s.label}>Meals</Text><Text>{m.meals}</Text></View>) : null}
                </View>
              )}
              <View wrap={false}>
                <Text style={s.h3}>Date-wise summary</Text>
                <View style={s.th}>
                  <Text style={[s.thText, { width: 40 }]}>Day</Text>
                  <Text style={[s.thText, { width: 92 }]}>Date</Text>
                  <Text style={[s.thText, { flex: 1 }]}>Plan</Text>
                </View>
                {m.days.map((d, i) => (
                  <View key={d.number} style={[s.tr, i % 2 ? s.trAlt : {}]}>
                    <Text style={{ width: 40, fontFamily: bold }}>{d.number}</Text>
                    <Text style={{ width: 92 }}>{d.date ? d.dateText : "—"}</Text>
                    <Text style={{ flex: 1 }}>{d.title}</Text>
                  </View>
                ))}
              </View>
            </Page>
          );

        if (p.kind === "days")
          return (
            <Page key={idx} size="A4" style={s.page}>
              <Head title={m.title} />
              <Footer />
              <Text style={s.h2}>Day-wise plan</Text>
              {p.days.map((d) => (
                <DayBlock key={d.number} d={d} />
              ))}
            </Page>
          );

        if (p.kind === "quote" && m.quote) {
          const q = m.quote;
          return (
            <Page key={idx} size="A4" style={s.page}>
              <Head title={m.title} />
              <Footer />
              <Text style={s.h2}>Quotation</Text>
              <Text style={[s.muted, { marginBottom: 8 }]}>
                {q.quotationNumber} · {q.optionName}
                {q.validUntilText ? ` · valid until ${q.validUntilText}` : ""}
              </Text>
              {q.intro ? <Para text={q.intro} /> : null}
              <View style={s.th}>
                <Text style={[s.thText, { flex: 1 }]}>Description</Text>
                <Text style={[s.thText, { width: 40, textAlign: "right" }]}>Qty</Text>
                <Text style={[s.thText, { width: 80, textAlign: "right" }]}>Rate</Text>
                <Text style={[s.thText, { width: 86, textAlign: "right" }]}>Amount</Text>
              </View>
              {q.lines.map((l, i) => (
                <View key={i} style={[s.tr, i % 2 ? s.trAlt : {}]} wrap={false}>
                  <Text style={{ flex: 1 }}>{l.description}</Text>
                  <Text style={{ width: 40, textAlign: "right" }}>{l.quantity}</Text>
                  <Text style={{ width: 80, textAlign: "right" }}>{pdfAmount(l.rate, q.currency)}</Text>
                  <Text style={{ width: 86, textAlign: "right" }}>{pdfAmount(l.amount, q.currency)}</Text>
                </View>
              ))}
              <View style={{ alignSelf: "flex-end", width: 250, marginTop: 10 }} wrap={false}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
                  <Text>Subtotal</Text>
                  <Text>{pdfAmount(q.subtotal, q.currency)}</Text>
                </View>
                {q.discount > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
                    <Text>{q.discountLabel}</Text>
                    <Text>- {pdfAmount(q.discount, q.currency)}</Text>
                  </View>
                )}
                {q.taxRate > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
                    <Text>GST ({q.taxRate}%)</Text>
                    <Text>{pdfAmount(q.tax, q.currency)}</Text>
                  </View>
                )}
                <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: t.primary, paddingVertical: 6, paddingHorizontal: 8, marginTop: 4, borderRadius: 3 }}>
                  <Text style={{ color: t.onPrimary, fontFamily: bold, fontSize: 11 }}>Total</Text>
                  <Text style={{ color: t.onPrimary, fontFamily: bold, fontSize: 11 }}>{pdfAmount(q.total, q.currency)}</Text>
                </View>
                {q.perPerson !== null && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 8 }}>
                    <Text style={s.muted}>Per person ({q.travellers} traveller{q.travellers === 1 ? "" : "s"})</Text>
                    <Text style={{ fontFamily: bold }}>{pdfAmount(q.perPerson, q.currency)}</Text>
                  </View>
                )}
              </View>
            </Page>
          );
        }

        if (p.kind === "policies")
          return (
            <Page key={idx} size="A4" style={s.page}>
              <Head title={m.title} />
              <Footer />
              <Text style={s.h2}>Inclusions, policies and payment</Text>
              {(m.inclusions.length > 0 || m.exclusions.length > 0) && (
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
                  {m.inclusions.length > 0 && (
                    <View style={{ flex: 1 }}>
                      <Text style={s.h3}>Included</Text>
                      <Bullets items={m.inclusions} color="#15803d" />
                    </View>
                  )}
                  {m.exclusions.length > 0 && (
                    <View style={{ flex: 1 }}>
                      <Text style={s.h3}>Not included</Text>
                      <Bullets items={m.exclusions} color="#b91c1c" />
                    </View>
                  )}
                </View>
              )}
              {m.paymentTerms ? (<View style={{ marginBottom: 8 }}><Text style={s.h3}>Payment terms</Text><Para text={m.paymentTerms} /></View>) : null}
              {m.cancellation ? (<View style={{ marginBottom: 8 }}><Text style={s.h3}>Cancellation policy</Text><Para text={m.cancellation} /></View>) : null}
              {m.terms ? (<View style={{ marginBottom: 8 }}><Text style={s.h3}>Terms and conditions</Text><Para text={m.terms} /></View>) : null}
              {m.bank.length > 0 && (
                <View style={s.panel} wrap={false}>
                  <Text style={s.h3}>Bank details</Text>
                  {m.bank.map((r) => (
                    <View key={r.label} style={{ flexDirection: "row", marginBottom: 2 }}>
                      <Text style={{ width: 100, color: t.muted }}>{r.label}</Text>
                      <Text style={{ fontFamily: bold }}>{r.value}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6 }} wrap={false}>
                <View>
                  {m.validUntilText ? <Text style={s.muted}>This quotation is valid until {m.validUntilText}.</Text> : null}
                </View>
                <View style={{ alignItems: "center" }}>
                  {m.signature ? <Image src={m.signature} style={{ height: 36, maxWidth: 130, objectFit: "contain" }} /> : null}
                  <Text style={{ borderTopWidth: 0.6, borderTopColor: t.muted, paddingTop: 2, fontSize: 8, color: t.muted, minWidth: 120, textAlign: "center" }}>
                    Authorised signatory, {b.name}
                  </Text>
                </View>
              </View>
            </Page>
          );
        return null;
      })}
    </Document>
  );
}
