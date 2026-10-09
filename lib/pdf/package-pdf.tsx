/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop (PDF output, not HTML) */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { readableOn } from "@/lib/packages/templates";
import type { PackageDocument } from "@/lib/packages/document";

// The built-in PDF fonts have no rupee sign, so amounts use the currency code (INR 42,500).
const money = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

/** `images` maps an image id to a data URI (fetched server-side from private storage). Missing images become placeholders. */
export function PackagePdf({
  doc,
  images,
}: {
  doc: PackageDocument;
  images: Record<string, string>;
}) {
  const { primary, secondary, accent, font, layout } = doc.theme;
  const base = font === "SERIF" ? "Times-Roman" : "Helvetica";
  const bold = font === "SERIF" ? "Times-Bold" : "Helvetica-Bold";
  const onPrimary = readableOn(primary);
  const s = StyleSheet.create({
    page: { padding: 36, paddingBottom: 50, fontSize: 10, fontFamily: base, color: "#1f2937" },
    h2: { fontSize: 14, fontFamily: bold, color: primary, marginBottom: 6 },
    h3: { fontSize: 11, fontFamily: bold, color: secondary },
    muted: { color: "#6b7280" },
    section: { marginBottom: 14 },
    chip: {
      backgroundColor: accent,
      color: readableOn(accent),
      paddingVertical: 2,
      paddingHorizontal: 6,
      borderRadius: 3,
      fontSize: 8,
      fontFamily: bold,
    },
    box: { borderWidth: 0.7, borderColor: "#d1d5db", borderRadius: 4, padding: 9 },
    row: { flexDirection: "row", gap: 10 },
    footer: {
      position: "absolute",
      bottom: 18,
      left: 36,
      right: 36,
      fontSize: 8,
      color: "#6b7280",
      flexDirection: "row",
      justifyContent: "space-between",
    },
  });
  const img = (id: string | null | undefined) => (id ? images[id] : undefined);
  const cover = img(doc.coverId);

  const placeholder = (h: number) => (
    <View
      style={{
        height: h,
        backgroundColor: secondary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: readableOn(secondary), fontSize: 11, opacity: 0.85 }}>
        {doc.destination || doc.templateName}
      </Text>
    </View>
  );

  const facts: [string, string][] = (
    [
      ["Duration", doc.durationText],
      ["Departure", fmtDate(doc.startDate)],
      ["Return", fmtDate(doc.returnDate)],
      ["Travellers", doc.travellers],
      ["Hotels", doc.hotelCategory ?? ""],
    ] as [string, string][]
  ).filter(([, v]) => v);

  const title = (light?: boolean) => (
    <View>
      <Text
        style={{
          fontSize: layout === "MAGAZINE" ? 30 : 26,
          fontFamily: bold,
          color: light ? "#ffffff" : primary,
          lineHeight: 1.15,
        }}
      >
        {doc.title}
      </Text>
      {doc.destination ? (
        <Text style={{ fontSize: 13, color: light ? "#ffffff" : secondary, marginTop: 4 }}>
          {doc.destination}
        </Text>
      ) : null}
      {doc.durationText ? (
        <Text style={{ fontSize: 11, color: light ? "#ffffff" : "#4b5563", marginTop: 2 }}>
          {doc.durationText}
        </Text>
      ) : null}
    </View>
  );

  const price = () =>
    doc.price.amount != null ? (
      <View style={{ marginTop: 10 }}>
        <Text style={{ fontSize: 8, color: "#6b7280" }}>PACKAGE PRICE</Text>
        <Text
          style={{
            fontSize: 18,
            fontFamily: bold,
            color: layout === "MAGAZINE" ? "#ffffff" : primary,
          }}
        >
          {money(doc.price.amount, doc.price.currency)}
          <Text style={{ fontSize: 9, fontFamily: base }}> {doc.price.note ?? "per person"}</Text>
        </Text>
      </View>
    ) : null;

  return (
    <Document title={doc.title} author={doc.contact.name}>
      {/* ---------- cover ---------- */}
      <Page size="A4" style={{ fontFamily: base, color: "#1f2937" }}>
        {layout === "MAGAZINE" && (
          <View style={{ flex: 1 }}>
            <View style={{ height: 520 }}>
              {cover ? (
                <Image src={cover} style={{ width: "100%", height: 520, objectFit: "cover" }} />
              ) : (
                placeholder(520)
              )}
            </View>
            <View
              style={{
                position: "absolute",
                top: 330,
                left: 0,
                right: 0,
                height: 190,
                backgroundColor: primary,
                opacity: 0.82,
                padding: 30,
                justifyContent: "flex-end",
              }}
            >
              {title(true)}
            </View>
            <View style={{ padding: 30, flex: 1, justifyContent: "space-between" }}>
              <View style={s.row}>
                {facts.map(([k, v]) => (
                  <View key={k} style={{ flexGrow: 1 }}>
                    <Text style={{ fontSize: 7, color: "#6b7280" }}>{k.toUpperCase()}</Text>
                    <Text style={{ fontFamily: bold }}>{v}</Text>
                  </View>
                ))}
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                }}
              >
                <View>
                  {doc.logo ? (
                    <Image
                      src={doc.logo}
                      style={{ height: 36, objectFit: "contain", alignSelf: "flex-start" }}
                    />
                  ) : (
                    <Text style={{ fontSize: 14, fontFamily: bold, color: primary }}>
                      {doc.contact.name}
                    </Text>
                  )}
                  <Text style={{ marginTop: 4, color: "#6b7280" }}>{doc.tagline}</Text>
                </View>
                <View style={{ backgroundColor: primary, padding: 12, borderRadius: 4 }}>
                  <Text style={{ color: onPrimary, fontSize: 8 }}>PACKAGE PRICE</Text>
                  <Text style={{ color: onPrimary, fontSize: 17, fontFamily: bold }}>
                    {doc.price.amount != null
                      ? money(doc.price.amount, doc.price.currency)
                      : "On request"}
                  </Text>
                  {doc.price.amount != null ? (
                    <Text style={{ color: onPrimary, fontSize: 8 }}>
                      {doc.price.note ?? "per person"}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        )}
        {layout === "MODERN" && (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View style={{ width: 26, backgroundColor: primary }} />
            <View style={{ flex: 1, padding: 32 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 18,
                }}
              >
                {doc.logo ? (
                  <Image src={doc.logo} style={{ height: 34, objectFit: "contain" }} />
                ) : (
                  <Text style={{ fontSize: 13, fontFamily: bold, color: primary }}>
                    {doc.contact.name}
                  </Text>
                )}
                <Text style={s.chip}>{doc.templateName.toUpperCase()}</Text>
              </View>
              {title()}
              <View style={{ marginTop: 16, borderRadius: 6, overflow: "hidden" }}>
                {cover ? (
                  <Image src={cover} style={{ width: "100%", height: 300, objectFit: "cover" }} />
                ) : (
                  placeholder(300)
                )}
              </View>
              <View style={[s.row, { marginTop: 14 }]}>
                {facts.map(([k, v]) => (
                  <View key={k} style={[s.box, { flexGrow: 1 }]}>
                    <Text style={{ fontSize: 7, color: "#6b7280" }}>{k.toUpperCase()}</Text>
                    <Text style={{ fontFamily: bold }}>{v}</Text>
                  </View>
                ))}
              </View>
              {price()}
              <Text style={{ marginTop: 14, color: "#4b5563" }}>{doc.tagline}</Text>
            </View>
          </View>
        )}
        {layout === "CLASSIC" && (
          <View
            style={{ flex: 1, margin: 22, borderWidth: 1.2, borderColor: secondary, padding: 8 }}
          >
            <View
              style={{
                flex: 1,
                borderWidth: 0.5,
                borderColor: secondary,
                padding: 26,
                alignItems: "center",
              }}
            >
              {doc.logo ? (
                <Image
                  src={doc.logo}
                  style={{ height: 40, objectFit: "contain", marginBottom: 6 }}
                />
              ) : (
                <Text style={{ fontSize: 14, fontFamily: bold, color: primary, marginBottom: 6 }}>
                  {doc.contact.name}
                </Text>
              )}
              <Text style={{ fontSize: 9, color: secondary, letterSpacing: 2, marginBottom: 16 }}>
                {doc.templateName.toUpperCase()}
              </Text>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <Text
                  style={{ fontSize: 28, fontFamily: bold, color: primary, textAlign: "center" }}
                >
                  {doc.title}
                </Text>
                {doc.destination ? (
                  <Text style={{ fontSize: 14, color: secondary, marginTop: 4 }}>
                    {doc.destination}
                  </Text>
                ) : null}
                {doc.durationText ? (
                  <Text style={{ marginTop: 3, color: "#4b5563" }}>{doc.durationText}</Text>
                ) : null}
              </View>
              <View style={{ width: "100%", borderWidth: 0.5, borderColor: accent }}>
                {cover ? (
                  <Image src={cover} style={{ width: "100%", height: 280, objectFit: "cover" }} />
                ) : (
                  placeholder(280)
                )}
              </View>
              <Text style={{ marginTop: 14, fontStyle: "italic", color: "#4b5563" }}>
                {doc.tagline}
              </Text>
              <View style={{ marginTop: 14, flexDirection: "row", gap: 18 }}>
                {facts.map(([k, v]) => (
                  <View key={k} style={{ alignItems: "center" }}>
                    <Text style={{ fontSize: 7, color: "#6b7280" }}>{k.toUpperCase()}</Text>
                    <Text style={{ fontFamily: bold }}>{v}</Text>
                  </View>
                ))}
              </View>
              {doc.price.amount != null ? (
                <View
                  style={{
                    marginTop: 16,
                    backgroundColor: primary,
                    paddingVertical: 8,
                    paddingHorizontal: 22,
                  }}
                >
                  <Text style={{ color: onPrimary, fontSize: 15, fontFamily: bold }}>
                    {money(doc.price.amount, doc.price.currency)}{" "}
                    <Text style={{ fontSize: 8, fontFamily: base }}>
                      {doc.price.note ?? "per person"}
                    </Text>
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        )}
        {doc.draft ? (
          <Text
            style={{
              position: "absolute",
              top: 14,
              right: 20,
              fontSize: 8,
              color: "#b91c1c",
              fontFamily: bold,
            }}
          >
            DRAFT
          </Text>
        ) : null}
      </Page>

      {/* ---------- content ---------- */}
      <Page size="A4" style={s.page} wrap>
        {doc.summary ? (
          <View style={s.section}>
            <Text style={s.h2}>Overview</Text>
            <Text style={{ lineHeight: 1.45 }}>{doc.summary}</Text>
          </View>
        ) : null}

        {doc.galleryIds.length > 0 && (
          <View style={[s.section, s.row]} wrap={false}>
            {doc.galleryIds
              .slice(0, 3)
              .map((id) =>
                img(id) ? (
                  <Image
                    key={id}
                    src={img(id)!}
                    style={{ flex: 1, height: 110, objectFit: "cover", borderRadius: 3 }}
                  />
                ) : null,
              )}
          </View>
        )}

        {(doc.accommodation || doc.transport || doc.flights || doc.meals || doc.activities) && (
          <View style={s.section}>
            <Text style={s.h2}>Stay, travel and experiences</Text>
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
                <View key={k} style={{ marginBottom: 5 }} wrap={false}>
                  <Text style={s.h3}>{k}</Text>
                  <Text style={{ lineHeight: 1.4 }}>{v}</Text>
                </View>
              ))}
            {doc.hotelIds.length > 0 && (
              <View style={[s.row, { marginTop: 6 }]} wrap={false}>
                {doc.hotelIds
                  .slice(0, 3)
                  .map((id) =>
                    img(id) ? (
                      <Image
                        key={id}
                        src={img(id)!}
                        style={{ flex: 1, height: 100, objectFit: "cover", borderRadius: 3 }}
                      />
                    ) : null,
                  )}
              </View>
            )}
          </View>
        )}

        {doc.days.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Day-by-day itinerary</Text>
            {doc.days.map((d) => (
              <View
                key={d.number}
                style={{ marginBottom: 9, flexDirection: "row", gap: 9 }}
                wrap={false}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: primary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: onPrimary, fontSize: 7 }}>DAY</Text>
                  <Text style={{ color: onPrimary, fontSize: 13, fontFamily: bold }}>
                    {d.number}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.h3, { fontSize: 12 }]}>{d.title}</Text>
                  {d.date ? (
                    <Text style={[s.muted, { fontSize: 8 }]}>{fmtDate(d.date)}</Text>
                  ) : null}
                  {d.description ? (
                    <Text style={{ marginTop: 2, lineHeight: 1.4 }}>{d.description}</Text>
                  ) : null}
                  {d.items.map((it, i) => (
                    <Text key={i} style={{ marginTop: 2, color: "#374151" }}>
                      • {it.time ? `${it.time}  ` : ""}
                      <Text style={{ fontFamily: bold }}>{it.title}</Text>
                      {it.description ? ` - ${it.description}` : ""}
                    </Text>
                  ))}
                  {d.imageIds.some((id) => img(id)) && (
                    <View style={[s.row, { marginTop: 4 }]}>
                      {d.imageIds
                        .slice(0, 2)
                        .map((id) =>
                          img(id) ? (
                            <Image
                              key={id}
                              src={img(id)!}
                              style={{ flex: 1, height: 92, objectFit: "cover", borderRadius: 3 }}
                            />
                          ) : null,
                        )}
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {(doc.inclusions.length > 0 || doc.exclusions.length > 0) && (
          <View style={[s.section, s.row]} wrap={false}>
            {doc.inclusions.length > 0 && (
              <View style={[s.box, { flex: 1 }]}>
                <Text style={s.h3}>Included</Text>
                {doc.inclusions.map((t, i) => (
                  <Text key={i} style={{ marginTop: 2 }}>
                    + {t}
                  </Text>
                ))}
              </View>
            )}
            {doc.exclusions.length > 0 && (
              <View style={[s.box, { flex: 1 }]}>
                <Text style={s.h3}>Not included</Text>
                {doc.exclusions.map((t, i) => (
                  <Text key={i} style={{ marginTop: 2 }}>
                    - {t}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {doc.price.amount != null && (
          <View style={[s.section, s.box]} wrap={false}>
            <Text style={s.h2}>Pricing</Text>
            <Text>
              Adult:{" "}
              <Text style={{ fontFamily: bold }}>
                {money(doc.price.amount, doc.price.currency)}
              </Text>{" "}
              {doc.price.note ?? "per person"}
            </Text>
            {doc.price.child != null ? (
              <Text>
                Child:{" "}
                <Text style={{ fontFamily: bold }}>
                  {money(doc.price.child, doc.price.currency)}
                </Text>
              </Text>
            ) : null}
            {doc.price.extra != null ? (
              <Text>
                Extra person:{" "}
                <Text style={{ fontFamily: bold }}>
                  {money(doc.price.extra, doc.price.currency)}
                </Text>
              </Text>
            ) : null}
          </View>
        )}

        {doc.cancellationPolicy ? (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Cancellation policy</Text>
            <Text style={{ lineHeight: 1.4 }}>{doc.cancellationPolicy}</Text>
          </View>
        ) : null}
        {doc.terms ? (
          <View style={s.section}>
            <Text style={s.h2}>Terms and conditions</Text>
            <Text style={{ fontSize: 9, lineHeight: 1.4 }}>{doc.terms}</Text>
          </View>
        ) : null}
        {doc.travelNotes ? (
          <View style={s.section}>
            <Text style={s.h2}>Important travel notes</Text>
            <Text style={{ lineHeight: 1.4 }}>{doc.travelNotes}</Text>
          </View>
        ) : null}

        <View style={{ backgroundColor: primary, padding: 14, borderRadius: 4 }} wrap={false}>
          <Text style={{ color: onPrimary, fontSize: 13, fontFamily: bold }}>{doc.cta}</Text>
          <Text style={{ color: onPrimary, marginTop: 4 }}>
            {[
              doc.contact.name,
              doc.contact.phone,
              doc.contact.whatsapp ? `WhatsApp ${doc.contact.whatsapp}` : null,
              doc.contact.email,
              doc.contact.website,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
          {doc.contact.address ? (
            <Text style={{ color: onPrimary, marginTop: 2, fontSize: 9 }}>
              {doc.contact.address}
            </Text>
          ) : null}
        </View>

        <View style={s.footer} fixed>
          <Text>{doc.contact.name}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${doc.title} · page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
        {doc.draft ? (
          <Text
            style={{
              position: "absolute",
              top: 14,
              right: 20,
              fontSize: 8,
              color: "#b91c1c",
              fontFamily: bold,
            }}
            fixed
          >
            DRAFT
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}
