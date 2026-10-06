/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop (PDF output, not HTML) */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Branded quotation PDF. Input is the NON-private quotation document (no supplier costs
 * or profit exist in it) so nothing sensitive can be rendered.
 * Standard PDF fonts lack the ₹ glyph, so amounts are printed with the currency code.
 */

type Item = {
  id: string;
  type: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
};
type Option = {
  id: string;
  name: string;
  subtotal: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  total: number | string;
  taxRate: number | string;
  items: Item[];
};
export type PdfQuotation = {
  number: string;
  title: string;
  currency: string;
  validUntil: string | null;
  intro: string | null;
  terms: string | null;
  cancellationPolicy: string | null;
  paymentTerms: string | null;
  selectedOptionId: string | null;
  options: Option[];
};
export type PdfItinerary = {
  destination?: string | null;
  summary?: string | null;
  startDate?: string | null;
  adults?: number;
  children?: number;
  inclusions?: string[];
  exclusions?: string[];
  days?: {
    title?: string | null;
    description?: string | null;
    notes?: string | null;
    items?: {
      type: string;
      title: string;
      description?: string | null;
      location?: string | null;
      time?: string | null;
    }[];
  }[];
} | null;
export type PdfBranding = {
  orgName: string;
  logo?: string | null;
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  gst?: string | null;
  facebook?: string | null;
  instagram?: string | null;
  youtube?: string | null;
  footer?: string | null;
};
export type PdfProps = {
  quotation: PdfQuotation;
  customer: { name: string; phone?: string | null; email?: string | null };
  itinerary: PdfItinerary;
  branding: PdfBranding;
};

const hexOr = (v: string | null | undefined, fallback: string) =>
  v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
export const pdfMoney = (n: number | string, currency: string) =>
  `${currency} ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

export function QuotationPdf({ quotation: q, customer, itinerary: it, branding: b }: PdfProps) {
  const primary = hexOr(b.primary, "#0f766e");
  const secondary = hexOr(b.secondary, "#134e4a");
  const accent = hexOr(b.accent, "#f59e0b");
  const s = StyleSheet.create({
    page: {
      padding: 40,
      paddingBottom: 60,
      fontSize: 10,
      fontFamily: "Helvetica",
      color: "#1f2937",
    },
    cover: { padding: 0, fontFamily: "Helvetica", color: "#ffffff", backgroundColor: primary },
    h1: { fontSize: 22, fontFamily: "Helvetica-Bold", color: primary, marginBottom: 6 },
    h2: {
      fontSize: 14,
      fontFamily: "Helvetica-Bold",
      color: secondary,
      marginBottom: 8,
      marginTop: 4,
    },
    h3: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 3 },
    muted: { color: "#6b7280" },
    row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    th: {
      flexDirection: "row",
      backgroundColor: primary,
      color: "#fff",
      paddingVertical: 4,
      paddingHorizontal: 6,
      fontFamily: "Helvetica-Bold",
    },
    tr: {
      flexDirection: "row",
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
    },
    card: {
      borderWidth: 0.5,
      borderColor: "#d1d5db",
      borderRadius: 4,
      padding: 10,
      marginBottom: 8,
    },
    footer: {
      position: "absolute",
      bottom: 24,
      left: 40,
      right: 40,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: 8,
      color: "#6b7280",
      borderTopWidth: 0.5,
      borderTopColor: "#d1d5db",
      paddingTop: 6,
    },
  });
  const footer = (
    <View style={s.footer} fixed>
      <Text>{b.footer || b.orgName}</Text>
      <Text
        render={({ pageNumber, totalPages }) => `${q.number} · Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );

  const hotels = (it?.days ?? []).flatMap((d, i) =>
    (d.items ?? []).filter((x) => x.type === "HOTEL").map((x) => ({ day: i + 1, ...x })),
  );
  const selected = q.options.find((o) => o.id === q.selectedOptionId);

  return (
    <Document title={`${q.number} – ${q.title}`} author={b.orgName} creator={b.orgName}>
      {/* 1. Cover */}
      <Page size="A4" style={s.cover}>
        <View style={{ padding: 48, flexGrow: 1, justifyContent: "space-between" }}>
          <View>
            {b.logo ? (
              <Image
                src={b.logo}
                style={{
                  height: 56,
                  objectFit: "contain",
                  alignSelf: "flex-start",
                  backgroundColor: "#ffffff",
                  padding: 6,
                  borderRadius: 4,
                }}
              />
            ) : (
              <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold" }}>{b.orgName}</Text>
            )}
          </View>
          <View>
            <View style={{ width: 60, height: 4, backgroundColor: accent, marginBottom: 14 }} />
            <Text style={{ fontSize: 30, fontFamily: "Helvetica-Bold" }}>{q.title}</Text>
            {it?.destination ? (
              <Text style={{ fontSize: 14, marginTop: 8 }}>{it.destination}</Text>
            ) : null}
            <Text style={{ fontSize: 12, marginTop: 24 }}>Prepared for {customer.name}</Text>
            <Text style={{ fontSize: 10, marginTop: 4, opacity: 0.85 }}>
              Quotation {q.number}
              {q.validUntil ? ` · Valid until ${q.validUntil}` : ""}
            </Text>
          </View>
          <Text style={{ fontSize: 9, opacity: 0.85 }}>
            {b.orgName}
            {b.website ? ` · ${b.website}` : ""}
          </Text>
        </View>
      </Page>

      {/* 2. Customer and trip summary */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Trip summary</Text>
        {q.intro ? <Text style={{ marginBottom: 10 }}>{q.intro}</Text> : null}
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.muted}>Prepared for</Text>
            <Text>{customer.name}</Text>
          </View>
          {customer.phone ? (
            <View style={s.row}>
              <Text style={s.muted}>Phone</Text>
              <Text>{customer.phone}</Text>
            </View>
          ) : null}
          {customer.email ? (
            <View style={s.row}>
              <Text style={s.muted}>Email</Text>
              <Text>{customer.email}</Text>
            </View>
          ) : null}
          {it?.destination ? (
            <View style={s.row}>
              <Text style={s.muted}>Destination</Text>
              <Text>{it.destination}</Text>
            </View>
          ) : null}
          {it?.startDate ? (
            <View style={s.row}>
              <Text style={s.muted}>Travel date</Text>
              <Text>{it.startDate}</Text>
            </View>
          ) : null}
          {it?.days?.length ? (
            <View style={s.row}>
              <Text style={s.muted}>Duration</Text>
              <Text>{it.days.length} days</Text>
            </View>
          ) : null}
          {it?.adults !== undefined ? (
            <View style={s.row}>
              <Text style={s.muted}>Travellers</Text>
              <Text>
                {it.adults} adult(s){it.children ? `, ${it.children} child(ren)` : ""}
              </Text>
            </View>
          ) : null}
          <View style={s.row}>
            <Text style={s.muted}>Quotation</Text>
            <Text>{q.number}</Text>
          </View>
        </View>
        {it?.summary ? <Text>{it.summary}</Text> : null}
        {footer}
      </Page>

      {/* 3. Day-wise itinerary */}
      {it?.days?.length ? (
        <Page size="A4" style={s.page} wrap>
          <Text style={s.h1}>Day-wise itinerary</Text>
          {it.days.map((d, i) => (
            <View key={i} style={s.card} wrap={false}>
              <Text style={s.h3}>
                Day {i + 1}
                {d.title ? ` – ${d.title}` : ""}
              </Text>
              {d.description ? <Text style={{ marginBottom: 4 }}>{d.description}</Text> : null}
              {(d.items ?? []).map((x, j) => (
                <Text key={j} style={{ marginBottom: 2 }}>
                  • {x.time ? `${x.time} ` : ""}
                  {label(x.type)}: {x.title}
                  {x.location ? ` (${x.location})` : ""}
                </Text>
              ))}
              {d.notes ? <Text style={[s.muted, { marginTop: 3 }]}>Note: {d.notes}</Text> : null}
            </View>
          ))}
          {footer}
        </Page>
      ) : null}

      {/* 4. Hotels */}
      {hotels.length ? (
        <Page size="A4" style={s.page}>
          <Text style={s.h1}>Hotels</Text>
          {hotels.map((h, i) => (
            <View key={i} style={s.card} wrap={false}>
              <Text style={s.h3}>{h.title}</Text>
              <Text style={s.muted}>
                Day {h.day}
                {h.location ? ` · ${h.location}` : ""}
              </Text>
              {h.description ? <Text style={{ marginTop: 3 }}>{h.description}</Text> : null}
            </View>
          ))}
          {footer}
        </Page>
      ) : null}

      {/* 5. Services */}
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>Services</Text>
        {q.options.map((o) => (
          <View key={o.id} wrap={false} style={{ marginBottom: 10 }}>
            <Text style={s.h2}>
              {o.name}
              {o.id === q.selectedOptionId ? "  (recommended)" : ""}
            </Text>
            {o.items.map((x) => (
              <View key={x.id} style={s.tr}>
                <Text style={{ width: 70 }}>{label(x.type)}</Text>
                <Text style={{ flexGrow: 1 }}>{x.description}</Text>
                <Text style={{ width: 40, textAlign: "right" }}>x{Number(x.quantity)}</Text>
              </View>
            ))}
          </View>
        ))}
        {footer}
      </Page>

      {/* 6. Pricing */}
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>Pricing</Text>
        {q.options.map((o) => (
          <View
            key={o.id}
            wrap={false}
            style={[s.card, o.id === selected?.id ? { borderColor: accent, borderWidth: 1.5 } : {}]}
          >
            <Text style={s.h2}>{o.name}</Text>
            <View style={s.th}>
              <Text style={{ flexGrow: 1 }}>Item</Text>
              <Text style={{ width: 40, textAlign: "right" }}>Qty</Text>
              <Text style={{ width: 90, textAlign: "right" }}>Rate</Text>
              <Text style={{ width: 100, textAlign: "right" }}>Amount</Text>
            </View>
            {o.items.map((x) => (
              <View key={x.id} style={s.tr}>
                <Text style={{ flexGrow: 1 }}>{x.description}</Text>
                <Text style={{ width: 40, textAlign: "right" }}>{Number(x.quantity)}</Text>
                <Text style={{ width: 90, textAlign: "right" }}>
                  {pdfMoney(x.unitPrice, q.currency)}
                </Text>
                <Text style={{ width: 100, textAlign: "right" }}>
                  {pdfMoney(x.lineTotal, q.currency)}
                </Text>
              </View>
            ))}
            <View style={s.row}>
              <Text>Subtotal</Text>
              <Text>{pdfMoney(o.subtotal, q.currency)}</Text>
            </View>
            {Number(o.discountAmount) > 0 ? (
              <View style={s.row}>
                <Text>Discount</Text>
                <Text>- {pdfMoney(o.discountAmount, q.currency)}</Text>
              </View>
            ) : null}
            {Number(o.taxAmount) > 0 ? (
              <View style={s.row}>
                <Text>Tax ({Number(o.taxRate)}%)</Text>
                <Text>{pdfMoney(o.taxAmount, q.currency)}</Text>
              </View>
            ) : null}
            <View style={[s.row, { borderTopWidth: 1, borderTopColor: primary, marginTop: 4 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12 }}>Total</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12 }}>
                {pdfMoney(o.total, q.currency)}
              </Text>
            </View>
          </View>
        ))}
        <Text style={[s.muted, { fontSize: 8 }]}>
          Prices are estimates until confirmed in writing and are not a guarantee of availability.
        </Text>
        {footer}
      </Page>

      {/* 7. Inclusions and exclusions */}
      {it?.inclusions?.length || it?.exclusions?.length ? (
        <Page size="A4" style={s.page}>
          {it?.inclusions?.length ? (
            <>
              <Text style={s.h1}>Inclusions</Text>
              {it.inclusions.map((x, i) => (
                <Text key={i} style={{ marginBottom: 2 }}>
                  • {x}
                </Text>
              ))}
            </>
          ) : null}
          {it?.exclusions?.length ? (
            <>
              <Text style={[s.h1, { marginTop: 18 }]}>Exclusions</Text>
              {it.exclusions.map((x, i) => (
                <Text key={i} style={{ marginBottom: 2 }}>
                  • {x}
                </Text>
              ))}
            </>
          ) : null}
          {footer}
        </Page>
      ) : null}

      {/* 8. Terms */}
      {q.paymentTerms || q.cancellationPolicy || q.terms ? (
        <Page size="A4" style={s.page} wrap>
          <Text style={s.h1}>Terms and conditions</Text>
          {q.paymentTerms ? (
            <>
              <Text style={s.h3}>Payment terms</Text>
              <Text>{q.paymentTerms}</Text>
            </>
          ) : null}
          {q.cancellationPolicy ? (
            <>
              <Text style={s.h3}>Cancellation policy</Text>
              <Text>{q.cancellationPolicy}</Text>
            </>
          ) : null}
          {q.terms ? (
            <>
              <Text style={s.h3}>Terms</Text>
              <Text>{q.terms}</Text>
            </>
          ) : null}
          {footer}
        </Page>
      ) : null}

      {/* 9. Contact */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Contact us</Text>
        <View style={s.card}>
          {b.logo ? (
            <Image
              src={b.logo}
              style={{ height: 40, objectFit: "contain", alignSelf: "flex-start", marginBottom: 8 }}
            />
          ) : null}
          <Text style={s.h3}>{b.orgName}</Text>
          {b.address ? <Text>{b.address}</Text> : null}
          {b.phone ? <Text>Phone: {b.phone}</Text> : null}
          {b.whatsapp ? <Text>WhatsApp: {b.whatsapp}</Text> : null}
          {b.email ? <Text>Email: {b.email}</Text> : null}
          {b.website ? <Text>Web: {b.website}</Text> : null}
          {b.gst ? <Text style={{ marginTop: 6 }}>GST: {b.gst}</Text> : null}
          {b.facebook || b.instagram || b.youtube ? (
            <Text style={[s.muted, { marginTop: 6 }]}>
              {[b.facebook, b.instagram, b.youtube].filter(Boolean).join("  ·  ")}
            </Text>
          ) : null}
        </View>
        {footer}
      </Page>
    </Document>
  );
}
