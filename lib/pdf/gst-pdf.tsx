/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop (PDF output, not HTML) */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { amountInWords } from "@/lib/gst/words";
import { stateName } from "@/lib/gst/states";
import { pdfMoney } from "@/lib/pdf/quotation-pdf";

export type PartyBlock = {
  legalName: string;
  tradeName?: string | null;
  address?: string | null;
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  email?: string | null;
  phone?: string | null;
  logo?: string | null;
};

export type GstLine = {
  description: string;
  sac?: string | null;
  quantity: number;
  unitPrice: number;
  rate: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

export type GstDocProps = {
  kind: "TAX_INVOICE" | "INVOICE" | "CREDIT_NOTE";
  number: string | null;
  date: string;
  dueDate?: string | null;
  watermark?: string | null;
  primary?: string | null;
  currency: string;
  supplier: PartyBlock;
  billTo: {
    name: string;
    address?: string | null;
    gstin?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  placeOfSupply?: string | null;
  supplyType: "INTRA" | "INTER" | "NONE";
  reference?: string | null; // booking number, or the invoice a credit note refers to
  lines: GstLine[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  rounding: number;
  total: number;
  pricesIncludeTax?: boolean;
  payment?: { paid: number; balance: number; status: string } | null;
  bank?: {
    name?: string | null;
    accountName?: string | null;
    accountNo?: string | null;
    ifsc?: string | null;
    upi?: string | null;
  } | null;
  notes?: string | null;
  terms?: string | null;
  reason?: string | null;
  signature?: string | null;
};

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hexOr = (v: string | null | undefined, fb: string) =>
  v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb;
const TITLES = {
  TAX_INVOICE: "TAX INVOICE",
  INVOICE: "INVOICE",
  CREDIT_NOTE: "CREDIT NOTE",
} as const;

export function GstDocumentPdf(p: GstDocProps) {
  const primary = hexOr(p.primary, "#1d4f91");
  const s = StyleSheet.create({
    page: {
      padding: 32,
      paddingBottom: 56,
      fontSize: 9,
      fontFamily: "Helvetica",
      color: "#1f2937",
    },
    head: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderBottomWidth: 2,
      borderBottomColor: primary,
      paddingBottom: 8,
      marginBottom: 10,
    },
    h1: { fontSize: 17, fontFamily: "Helvetica-Bold", color: primary },
    label: { color: "#6b7280", fontSize: 7, textTransform: "uppercase", marginBottom: 2 },
    box: {
      borderWidth: 0.5,
      borderColor: "#d1d5db",
      borderRadius: 3,
      padding: 7,
      flexGrow: 1,
      flexBasis: 0,
    },
    row: { flexDirection: "row", gap: 8, marginBottom: 8 },
    th: {
      flexDirection: "row",
      backgroundColor: "#f3f4f6",
      fontFamily: "Helvetica-Bold",
      paddingVertical: 3,
      fontSize: 8,
    },
    tr: {
      flexDirection: "row",
      paddingVertical: 3,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
    },
    bold: { fontFamily: "Helvetica-Bold" },
    footer: {
      position: "absolute",
      bottom: 22,
      left: 32,
      right: 32,
      fontSize: 7,
      color: "#6b7280",
      textAlign: "center",
    },
  });
  const tax = p.supplyType !== "NONE";
  const sup = p.supplier;
  const w = {
    INTRA: {
      desc: "24%",
      sac: "8%",
      qty: "5%",
      price: "10%",
      gst: "6%",
      taxable: "11%",
      cgst: "9%",
      sgst: "9%",
      igst: "0%",
      total: "12%",
    },
    INTER: {
      desc: "28%",
      sac: "9%",
      qty: "6%",
      price: "11%",
      gst: "6%",
      taxable: "12%",
      cgst: "0%",
      sgst: "0%",
      igst: "10%",
      total: "13%",
    },
    NONE: {
      desc: "44%",
      sac: "0%",
      qty: "8%",
      price: "16%",
      gst: "0%",
      taxable: "16%",
      cgst: "0%",
      sgst: "0%",
      igst: "0%",
      total: "16%",
    },
  }[p.supplyType];
  const cols = [
    { k: "desc", w: w.desc, h: "Description", r: false },
    ...(tax ? [{ k: "sac", w: w.sac, h: "SAC", r: false }] : []),
    { k: "qty", w: w.qty, h: "Qty", r: true },
    { k: "price", w: w.price, h: "Price", r: true },
    ...(tax ? [{ k: "gst", w: w.gst, h: "GST", r: true }] : []),
    { k: "taxable", w: w.taxable, h: "Taxable", r: true },
    ...(p.supplyType === "INTRA"
      ? [
          { k: "cgst", w: w.cgst, h: "CGST", r: true },
          { k: "sgst", w: w.sgst, h: "SGST", r: true },
        ]
      : []),
    ...(p.supplyType === "INTER" ? [{ k: "igst", w: w.igst, h: "IGST", r: true }] : []),
    { k: "total", w: w.total, h: "Amount", r: true },
  ];
  const cell = (l: GstLine, k: string): string => {
    switch (k) {
      case "desc":
        return (
          l.description + (l.discount > 0 ? ` (discount ${pdfMoney(l.discount, p.currency)})` : "")
        );
      case "sac":
        return l.sac ?? "";
      case "qty":
        return String(l.quantity);
      case "price":
        return fmt(l.unitPrice);
      case "gst":
        return `${l.rate}%`;
      case "taxable":
        return fmt(l.taxable);
      case "cgst":
        return fmt(l.cgst);
      case "sgst":
        return fmt(l.sgst);
      case "igst":
        return fmt(l.igst);
      default:
        return fmt(l.total);
    }
  };
  // when tax is shown the "Price" column is the GST rate; the unit price is part of the taxable value
  const taxableTotal = p.subtotal;

  return (
    <Document title={`${TITLES[p.kind]} ${p.number ?? "draft"}`} author={sup.legalName}>
      <Page size="A4" style={s.page}>
        {p.watermark ? (
          <Text
            style={{
              position: "absolute",
              top: 330,
              left: 90,
              fontSize: 70,
              color: "#e5e7eb",
              transform: "rotate(-30deg)",
              fontFamily: "Helvetica-Bold",
            }}
            fixed
          >
            {p.watermark}
          </Text>
        ) : null}
        <View style={s.head}>
          <View style={{ maxWidth: 300 }}>
            {sup.logo ? (
              <Image
                src={sup.logo}
                style={{
                  height: 38,
                  objectFit: "contain",
                  marginBottom: 4,
                  alignSelf: "flex-start",
                }}
              />
            ) : null}
            <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>
              {sup.tradeName || sup.legalName}
            </Text>
            {sup.tradeName && sup.tradeName !== sup.legalName ? <Text>{sup.legalName}</Text> : null}
            {sup.address ? <Text>{sup.address}</Text> : null}
            {sup.gstin ? <Text>GSTIN: {sup.gstin}</Text> : null}
            {sup.pan ? <Text>PAN: {sup.pan}</Text> : null}
            {sup.stateCode ? (
              <Text>
                State: {stateName(sup.stateCode)} ({sup.stateCode})
              </Text>
            ) : null}
            {sup.phone || sup.email ? (
              <Text>{[sup.phone, sup.email].filter(Boolean).join(" · ")}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{TITLES[p.kind]}</Text>
            <Text style={s.bold}>{p.number ?? "DRAFT (not yet issued)"}</Text>
            <Text>Date: {p.date}</Text>
            <Text>Amounts in {p.currency}</Text>
            {p.dueDate ? <Text>Due: {p.dueDate}</Text> : null}
            {p.reference ? (
              <Text>
                {p.kind === "CREDIT_NOTE" ? "Against invoice" : "Booking"}: {p.reference}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.row}>
          <View style={s.box}>
            <Text style={s.label}>{p.kind === "CREDIT_NOTE" ? "Credited to" : "Billed to"}</Text>
            <Text style={s.bold}>{p.billTo.name}</Text>
            {p.billTo.address ? <Text>{p.billTo.address}</Text> : null}
            {p.billTo.gstin ? <Text>GSTIN: {p.billTo.gstin}</Text> : null}
            {p.billTo.email ? <Text>{p.billTo.email}</Text> : null}
            {p.billTo.phone ? <Text>{p.billTo.phone}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Supply</Text>
            {p.placeOfSupply ? (
              <Text>
                Place of supply: {stateName(p.placeOfSupply)} ({p.placeOfSupply})
              </Text>
            ) : (
              <Text>Place of supply: —</Text>
            )}
            {tax ? (
              <Text>
                {p.supplyType === "INTRA"
                  ? "Intra-state supply (CGST + SGST)"
                  : "Inter-state supply (IGST)"}
              </Text>
            ) : (
              <Text>No tax charged</Text>
            )}
            {p.pricesIncludeTax && tax ? <Text>Line prices include tax</Text> : null}
            {p.reason ? <Text>Reason: {p.reason}</Text> : null}
          </View>
        </View>

        <View style={s.th}>
          {cols.map((c) => (
            <Text
              key={c.k}
              style={{ width: c.w, textAlign: c.r ? "right" : "left", paddingHorizontal: 3 }}
            >
              {c.h}
            </Text>
          ))}
        </View>
        {p.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            {cols.map((c) => (
              <Text
                key={c.k}
                style={{ width: c.w, textAlign: c.r ? "right" : "left", paddingHorizontal: 3 }}
              >
                {cell(l, c.k)}
              </Text>
            ))}
          </View>
        ))}

        <View style={{ alignItems: "flex-end", marginTop: 8 }} wrap={false}>
          <View style={{ width: 230 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text>Taxable value</Text>
              <Text>{pdfMoney(taxableTotal, p.currency)}</Text>
            </View>
            {p.supplyType === "INTRA" ? (
              <>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text>CGST</Text>
                  <Text>{pdfMoney(p.cgst, p.currency)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text>SGST</Text>
                  <Text>{pdfMoney(p.sgst, p.currency)}</Text>
                </View>
              </>
            ) : null}
            {p.supplyType === "INTER" ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text>IGST</Text>
                <Text>{pdfMoney(p.igst, p.currency)}</Text>
              </View>
            ) : null}
            {Math.abs(p.rounding) >= 0.005 ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text>Round off</Text>
                <Text>{pdfMoney(p.rounding, p.currency)}</Text>
              </View>
            ) : null}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                borderTopWidth: 1,
                borderTopColor: "#9ca3af",
                marginTop: 3,
                paddingTop: 3,
              }}
            >
              <Text style={[s.bold, { fontSize: 11 }]}>Total</Text>
              <Text style={[s.bold, { fontSize: 11 }]}>{pdfMoney(p.total, p.currency)}</Text>
            </View>
            {p.payment ? (
              <>
                <View
                  style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}
                >
                  <Text>Paid to date</Text>
                  <Text>{pdfMoney(p.payment.paid, p.currency)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={s.bold}>Balance due ({p.payment.status})</Text>
                  <Text style={s.bold}>{pdfMoney(p.payment.balance, p.currency)}</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>
        <Text style={{ marginTop: 6 }}>Amount in words: {amountInWords(p.total, p.currency)}</Text>

        <View style={[s.row, { marginTop: 10 }]} wrap={false}>
          {p.bank && (p.bank.accountNo || p.bank.upi) ? (
            <View style={s.box}>
              <Text style={s.label}>Pay to</Text>
              {p.bank.accountName ? <Text>{p.bank.accountName}</Text> : null}
              {p.bank.name ? <Text>{p.bank.name}</Text> : null}
              {p.bank.accountNo ? (
                <Text>
                  A/c: {p.bank.accountNo}
                  {p.bank.ifsc ? ` · IFSC: ${p.bank.ifsc}` : ""}
                </Text>
              ) : null}
              {p.bank.upi ? <Text>UPI: {p.bank.upi}</Text> : null}
            </View>
          ) : null}
          <View style={[s.box, { alignItems: "flex-end", justifyContent: "flex-end" }]}>
            {p.signature ? (
              <Image src={p.signature} style={{ height: 36, objectFit: "contain" }} />
            ) : (
              <View style={{ height: 36 }} />
            )}
            <Text style={{ fontSize: 8 }}>
              Authorised signatory, {sup.tradeName || sup.legalName}
            </Text>
          </View>
        </View>
        {p.notes ? (
          <View style={{ marginTop: 4 }}>
            <Text style={s.label}>Notes</Text>
            <Text>{p.notes}</Text>
          </View>
        ) : null}
        {p.terms ? (
          <View style={{ marginTop: 6 }}>
            <Text style={s.label}>Terms and conditions</Text>
            <Text style={{ fontSize: 8 }}>{p.terms}</Text>
          </View>
        ) : null}
        <Text style={s.footer} fixed>
          This is a computer-generated document.{" "}
          {p.number ? "" : "DRAFT: not valid as an invoice until issued."}
        </Text>
      </Page>
    </Document>
  );
}
