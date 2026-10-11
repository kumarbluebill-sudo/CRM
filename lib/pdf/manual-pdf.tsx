import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Block, Inline } from "@/lib/help/markdown";

export type ManualSection = { title: string; category: string; blocks: Block[] };

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10.5, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  cover: { marginTop: 220 },
  title: { fontSize: 28, fontWeight: 700 },
  muted: { color: "#6b7280" },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  cat: { fontSize: 9, color: "#6b7280", marginBottom: 8, textTransform: "uppercase" },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 8, marginBottom: 3 },
  h3: { fontSize: 11, fontWeight: 700, marginTop: 6, marginBottom: 2 },
  p: { marginBottom: 5 },
  li: { flexDirection: "row", marginBottom: 2 },
  bullet: { width: 14 },
  note: { backgroundColor: "#eff6ff", padding: 6, marginBottom: 5, borderRadius: 3 },
  img: { width: "100%", marginBottom: 2 },
  cap: { fontSize: 8.5, color: "#6b7280", marginBottom: 6 },
  bold: { fontWeight: 700 },
  mono: { fontFamily: "Courier" },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 8, color: "#9ca3af" },
});

function Inl({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, n) =>
        i.t === "b" ? (
          <Text key={n} style={s.bold}>
            {i.v}
          </Text>
        ) : i.t === "i" ? (
          <Text key={n} style={{ fontFamily: "Helvetica-Oblique" }}>
            {i.v}
          </Text>
        ) : i.t === "code" ? (
          <Text key={n} style={s.mono}>
            {i.v}
          </Text>
        ) : i.t === "a" ? (
          <Text key={n}>{i.v}</Text>
        ) : (
          <Text key={n}>{i.v}</Text>
        ),
      )}
    </>
  );
}

function Blocks({ blocks, images }: { blocks: Block[]; images: Map<string, Buffer> }) {
  return (
    <>
      {blocks.map((b, n) => {
        switch (b.t) {
          case "h":
            return (
              <Text key={n} style={b.level === 3 ? s.h3 : s.h2}>
                {b.text}
              </Text>
            );
          case "p":
            return (
              <Text key={n} style={s.p}>
                <Inl items={b.inline} />
              </Text>
            );
          case "note":
            return (
              <View key={n} style={s.note}>
                <Text>
                  <Inl items={b.inline} />
                </Text>
              </View>
            );
          case "ul":
          case "ol":
            return (
              <View key={n} style={{ marginBottom: 4 }}>
                {b.items.map((it, i) => (
                  <View key={i} style={s.li} wrap={false}>
                    <Text style={s.bullet}>{b.t === "ol" ? `${i + 1}.` : "•"}</Text>
                    <Text style={{ flex: 1 }}>
                      <Inl items={it} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "img": {
            const data = images.get(b.src);
            return data ? (
              <View key={n} wrap={false}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image has no alt attribute; the caption below describes it */}
                <Image src={data} style={s.img} />
                <Text style={s.cap}>{b.alt}</Text>
              </View>
            ) : null;
          }
          default:
            return null;
        }
      })}
    </>
  );
}

export function ManualPdf({
  organization,
  generatedOn,
  sections,
  images,
}: {
  organization: string;
  generatedOn: string;
  sections: ManualSection[];
  images: Map<string, Buffer>;
}) {
  return (
    <Document title="Smart Travel CRM user manual">
      <Page size="A4" style={s.page}>
        <View style={s.cover}>
          <Text style={s.title}>Smart Travel CRM</Text>
          <Text style={{ fontSize: 16, marginTop: 4 }}>User manual</Text>
          <Text style={[s.muted, { marginTop: 24 }]}>Prepared for {organization}</Text>
          <Text style={s.muted}>{generatedOn}</Text>
          <Text style={[s.muted, { marginTop: 16 }]}>
            Only the guides that match your role are included.
          </Text>
        </View>
      </Page>
      {sections.map((sec, i) => (
        <Page key={i} size="A4" style={s.page}>
          <Text style={s.cat}>{sec.category}</Text>
          <Text style={s.h1}>{sec.title}</Text>
          <Blocks blocks={sec.blocks} images={images} />
          <Text
            style={s.footer}
            fixed
            render={({ pageNumber }) => `Smart Travel CRM user manual · page ${pageNumber}`}
          />
        </Page>
      ))}
    </Document>
  );
}
