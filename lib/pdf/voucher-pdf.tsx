/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop (PDF output, not HTML) */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/** Service voucher for one confirmed booking line. Contains no prices, costs or passport data. */
export type VoucherProps = {
  bookingNumber: string;
  title: string;
  serviceType: string;
  description: string;
  serviceDate: string | null;
  confirmationReference: string | null;
  quantity: number;
  notes: string | null;
  supplier: {
    name: string;
    phone?: string | null;
    email?: string | null;
    destination?: string | null;
  };
  passengers: string[];
  travel: { start: string | null; end: string | null };
  branding: {
    orgName: string;
    logo?: string | null;
    primary?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    footer?: string | null;
  };
};

const hexOr = (v: string | null | undefined, fb: string) =>
  v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb;
const pretty = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

export function VoucherPdf(p: VoucherProps) {
  const primary = hexOr(p.branding.primary, "#0f766e");
  const s = StyleSheet.create({
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
    block: { marginBottom: 12 },
    box: {
      borderWidth: 0.5,
      borderColor: "#d1d5db",
      borderRadius: 4,
      padding: 10,
      marginBottom: 12,
    },
    row: { flexDirection: "row", gap: 24 },
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
  return (
    <Document title={`Voucher ${p.bookingNumber}`} author={p.branding.orgName}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {p.branding.logo ? (
            <Image src={p.branding.logo} style={{ height: 40, objectFit: "contain" }} />
          ) : (
            <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold" }}>{p.branding.orgName}</Text>
          )}
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{pretty(p.serviceType)} voucher</Text>
            <Text>Booking {p.bookingNumber}</Text>
          </View>
        </View>

        <View style={s.box}>
          <Text style={s.label}>Service</Text>
          <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold" }}>{p.description}</Text>
          <View style={[s.row, { marginTop: 8 }]}>
            <View>
              <Text style={s.label}>Date</Text>
              <Text>{p.serviceDate ?? "As per itinerary"}</Text>
            </View>
            <View>
              <Text style={s.label}>Quantity</Text>
              <Text>{p.quantity}</Text>
            </View>
            <View>
              <Text style={s.label}>Confirmation no.</Text>
              <Text>{p.confirmationReference ?? "—"}</Text>
            </View>
          </View>
        </View>

        <View style={s.box}>
          <Text style={s.label}>Provided by</Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.supplier.name}</Text>
          {p.supplier.destination ? <Text>{p.supplier.destination}</Text> : null}
          {p.supplier.phone ? <Text>Phone: {p.supplier.phone}</Text> : null}
          {p.supplier.email ? <Text>Email: {p.supplier.email}</Text> : null}
        </View>

        <View style={s.block}>
          <Text style={s.label}>Guests</Text>
          {p.passengers.map((n, i) => (
            <Text key={i}>
              {i + 1}. {n}
            </Text>
          ))}
        </View>
        <View style={s.block}>
          <Text style={s.label}>Trip</Text>
          <Text>
            {p.title}
            {p.travel.start
              ? ` · ${p.travel.start}${p.travel.end ? ` to ${p.travel.end}` : ""}`
              : ""}
          </Text>
        </View>
        {p.notes ? (
          <View style={s.block}>
            <Text style={s.label}>Notes</Text>
            <Text>{p.notes}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>
            Issued by {p.branding.orgName}
            {p.branding.phone ? ` · ${p.branding.phone}` : ""}
            {p.branding.email ? ` · ${p.branding.email}` : ""}
            {p.branding.address ? ` · ${p.branding.address}` : ""}
          </Text>
          {p.branding.footer ? <Text>{p.branding.footer}</Text> : null}
          <Text>
            Please present this voucher on arrival. Valid only for the services and dates shown.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
