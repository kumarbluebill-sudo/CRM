/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop (PDF output, not HTML) */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfMoney } from "@/lib/pdf/quotation-pdf";

type Branding = {
  orgName: string;
  logo?: string | null;
  primary?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  footer?: string | null;
};

const hexOr = (v: string | null | undefined, fb: string) =>
  v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb;
const pretty = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

function styles(primary: string) {
  return StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
    head: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: primary,
      paddingBottom: 10,
      marginBottom: 16,
    },
    h1: { fontSize: 20, fontFamily: "Helvetica-Bold", color: primary },
    label: { color: "#6b7280", fontSize: 8, textTransform: "uppercase", marginBottom: 2 },
    box: {
      borderWidth: 0.5,
      borderColor: "#d1d5db",
      borderRadius: 4,
      padding: 10,
      marginBottom: 12,
    },
    row: { flexDirection: "row", gap: 24 },
    tr: {
      flexDirection: "row",
      paddingVertical: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
    },
    th: {
      flexDirection: "row",
      paddingVertical: 4,
      backgroundColor: "#f3f4f6",
      fontFamily: "Helvetica-Bold",
    },
    footer: {
      position: "absolute",
      bottom: 28,
      left: 40,
      right: 40,
      fontSize: 8,
      color: "#6b7280",
      borderTopWidth: 0.5,
      borderTopColor: "#d1d5db",
      paddingTop: 6,
    },
  });
}

function Header({
  b,
  s,
  title,
  number,
}: {
  b: Branding;
  s: ReturnType<typeof styles>;
  title: string;
  number: string;
}) {
  return (
    <View style={s.head}>
      {b.logo ? (
        <Image src={b.logo} style={{ height: 40, objectFit: "contain" }} />
      ) : (
        <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold" }}>{b.orgName}</Text>
      )}
      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.h1}>{title}</Text>
        <Text>{number}</Text>
      </View>
    </View>
  );
}

function Footer({ b, s }: { b: Branding; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {b.orgName}
        {b.phone ? ` · ${b.phone}` : ""}
        {b.email ? ` · ${b.email}` : ""}
        {b.address ? ` · ${b.address}` : ""}
      </Text>
      {b.footer ? <Text>{b.footer}</Text> : null}
    </View>
  );
}

export type InvoicePdfProps = {
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  total: number;
  paid: number;
  bookingNumber: string;
  tripTitle: string;
  billTo: { name: string; email?: string | null; phone?: string | null; address?: string | null };
  lines: { description: string; quantity: number; unitPrice: number | null }[];
  notes: string | null;
  branding: Branding;
};

export function InvoicePdf(p: InvoicePdfProps) {
  const s = styles(hexOr(p.branding.primary, "#0f766e"));
  const lineSum = p.lines.reduce((t, l) => t + (l.unitPrice ?? 0) * l.quantity, 0);
  const other = Math.round((p.total - lineSum) * 100) / 100;
  const balance = Math.round((p.total - p.paid) * 100) / 100;
  return (
    <Document title={`Invoice ${p.invoiceNumber}`} author={p.branding.orgName}>
      <Page size="A4" style={s.page}>
        <Header b={p.branding} s={s} title="INVOICE" number={p.invoiceNumber} />
        {p.status === "VOID" ? (
          <Text style={{ color: "#b91c1c", fontFamily: "Helvetica-Bold", marginBottom: 8 }}>
            VOID — this invoice is cancelled
          </Text>
        ) : null}
        <View style={[s.row, { marginBottom: 12 }]}>
          <View style={[s.box, { flexGrow: 1 }]}>
            <Text style={s.label}>Billed to</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.billTo.name}</Text>
            {p.billTo.address ? <Text>{p.billTo.address}</Text> : null}
            {p.billTo.email ? <Text>{p.billTo.email}</Text> : null}
            {p.billTo.phone ? <Text>{p.billTo.phone}</Text> : null}
          </View>
          <View style={[s.box, { flexGrow: 1 }]}>
            <Text style={s.label}>Details</Text>
            <Text>Issued: {p.issueDate}</Text>
            {p.dueDate ? <Text>Due: {p.dueDate}</Text> : null}
            <Text>Booking: {p.bookingNumber}</Text>
            <Text>{p.tripTitle}</Text>
          </View>
        </View>

        <View style={s.th}>
          <Text style={{ flexGrow: 1, paddingLeft: 4 }}>Description</Text>
          <Text style={{ width: 40, textAlign: "right" }}>Qty</Text>
          <Text style={{ width: 90, textAlign: "right" }}>Rate</Text>
          <Text style={{ width: 100, textAlign: "right", paddingRight: 4 }}>Amount</Text>
        </View>
        {p.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={{ flexGrow: 1, paddingLeft: 4, maxWidth: 300 }}>{l.description}</Text>
            <Text style={{ width: 40, textAlign: "right" }}>{l.quantity}</Text>
            <Text style={{ width: 90, textAlign: "right" }}>
              {l.unitPrice == null ? "—" : pdfMoney(l.unitPrice, p.currency)}
            </Text>
            <Text style={{ width: 100, textAlign: "right", paddingRight: 4 }}>
              {l.unitPrice == null ? "—" : pdfMoney(l.unitPrice * l.quantity, p.currency)}
            </Text>
          </View>
        ))}
        {Math.abs(other) >= 0.01 ? (
          <View style={s.tr}>
            <Text style={{ flexGrow: 1, paddingLeft: 4 }}>
              {other > 0 ? "Taxes and other charges" : "Discounts and adjustments"}
            </Text>
            <Text style={{ width: 100, textAlign: "right", paddingRight: 4 }}>
              {pdfMoney(other, p.currency)}
            </Text>
          </View>
        ) : null}

        <View style={{ alignItems: "flex-end", marginTop: 12 }} wrap={false}>
          <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>
            Total: {pdfMoney(p.total, p.currency)}
          </Text>
          <Text>Paid to date: {pdfMoney(p.paid, p.currency)}</Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            Balance due: {pdfMoney(balance, p.currency)}
          </Text>
        </View>
        {p.notes ? (
          <View style={{ marginTop: 14 }}>
            <Text style={s.label}>Notes</Text>
            <Text>{p.notes}</Text>
          </View>
        ) : null}
        <Footer b={p.branding} s={s} />
      </Page>
    </Document>
  );
}

export type ReceiptPdfProps = {
  receiptNumber: string;
  paidAt: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  bookingNumber: string;
  tripTitle: string;
  customerName: string;
  bookingTotal: number;
  bookingPaid: number;
  branding: Branding;
};

export function ReceiptPdf(p: ReceiptPdfProps) {
  const s = styles(hexOr(p.branding.primary, "#0f766e"));
  const balance = Math.round((p.bookingTotal - p.bookingPaid) * 100) / 100;
  return (
    <Document title={`Receipt ${p.receiptNumber}`} author={p.branding.orgName}>
      <Page size="A4" style={s.page}>
        <Header b={p.branding} s={s} title="PAYMENT RECEIPT" number={p.receiptNumber} />
        <View style={s.box}>
          <Text style={s.label}>Amount received</Text>
          <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold" }}>
            {pdfMoney(p.amount, p.currency)}
          </Text>
          <View style={[s.row, { marginTop: 8 }]}>
            <View>
              <Text style={s.label}>Received from</Text>
              <Text>{p.customerName}</Text>
            </View>
            <View>
              <Text style={s.label}>Date</Text>
              <Text>{p.paidAt}</Text>
            </View>
            <View>
              <Text style={s.label}>Method</Text>
              <Text>{pretty(p.method)}</Text>
            </View>
            {p.reference ? (
              <View>
                <Text style={s.label}>Reference</Text>
                <Text>{p.reference}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={s.box}>
          <Text style={s.label}>Towards</Text>
          <Text>
            {p.tripTitle} ({p.bookingNumber})
          </Text>
          <Text>Booking total: {pdfMoney(p.bookingTotal, p.currency)}</Text>
          <Text>Paid to date: {pdfMoney(p.bookingPaid, p.currency)}</Text>
          <Text>Balance: {pdfMoney(balance, p.currency)}</Text>
        </View>
        <Text style={{ color: "#6b7280" }}>This is a computer-generated receipt.</Text>
        <Footer b={p.branding} s={s} />
      </Page>
    </Document>
  );
}
