import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type BillingReceiptProps = {
  number: string;
  organization: string;
  plan: string;
  /** Rupees, already converted from paise. */
  amount: string;
  issuedOn: string;
  periodEnd: string | null;
};

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937" },
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  muted: { color: "#6b7280" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: 700,
  },
  note: { marginTop: 28, fontSize: 9, color: "#6b7280" },
});

/**
 * Payment receipt for a subscription payment. It is a receipt, not a GST tax invoice: the operator's accountant must
 * confirm their own tax registration and invoice requirements before this is described to customers as one.
 */
export function BillingReceiptPdf(p: BillingReceiptProps) {
  return (
    <Document title={`Receipt ${p.number}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Payment receipt</Text>
        <Text style={s.muted}>{p.number}</Text>
        <View style={{ marginTop: 24 }}>
          <View style={s.row}>
            <Text>Billed to</Text>
            <Text>{p.organization}</Text>
          </View>
          <View style={s.row}>
            <Text>Plan</Text>
            <Text>{p.plan}</Text>
          </View>
          <View style={s.row}>
            <Text>Date</Text>
            <Text>{p.issuedOn}</Text>
          </View>
          {p.periodEnd && (
            <View style={s.row}>
              <Text>Paid until</Text>
              <Text>{p.periodEnd}</Text>
            </View>
          )}
          <View style={s.total}>
            <Text>Amount paid</Text>
            <Text>{p.amount}</Text>
          </View>
        </View>
        <Text style={s.note}>
          This receipt confirms a subscription payment received through our payment provider. It is
          not a GST tax invoice.
        </Text>
      </Page>
    </Document>
  );
}
