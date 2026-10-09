import { z } from "zod";

export const ITEM_TYPES = ["ACTIVITY", "HOTEL", "TRANSFER", "MEAL", "FLIGHT", "NOTE"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const MAX_DAYS = 60;
export const MAX_ITEMS_PER_DAY = 50;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Only https image URLs are accepted (the page never renders javascript:/data: URLs). */
const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .refine((v) => !v || /^https:\/\/[^\s]+$/i.test(v), "Image must be an https:// URL")
  .transform((v) => (v ? v : null));

export const itemSchema = z.object({
  type: z.enum(ITEM_TYPES),
  title: z.string().trim().min(1, "Give every item a title").max(200),
  description: text(3000),
  location: text(200),
  time: z
    .string()
    .nullish()
    .refine((v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Use HH:MM")
    .transform((v) => (v ? v : null)),
  imageUrl,
});

export const daySchema = z.object({
  title: text(200),
  description: text(5000),
  notes: text(2000),
  items: z.array(itemSchema).max(MAX_ITEMS_PER_DAY),
});

const lines = z.array(z.string().trim().min(1).max(300)).max(100);
const uuidOrNull = z
  .string()
  .nullish()
  .refine((v) => !v || z.string().uuid().safeParse(v).success, "Invalid id")
  .transform((v) => (v ? v : null));

export const itineraryDocSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(200),
  destination: text(200),
  summary: text(5000),
  customerId: uuidOrNull,
  leadId: uuidOrNull,
  startDate: z
    .string()
    .nullish()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
    .transform((v) => (v ? v : null)),
  adults: z.coerce.number().int().min(0).max(200).default(1),
  children: z.coerce.number().int().min(0).max(200).default(0),
  inclusions: lines.default([]),
  exclusions: lines.default([]),
  notes: text(5000),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  isTemplate: z.boolean().default(false),
  days: z.array(daySchema).max(MAX_DAYS),
});

export type ItineraryDoc = z.input<typeof itineraryDocSchema> & { id?: string; version?: number };

/** Editor-side shapes (always fully populated strings so inputs stay controlled). */
export type EditorItem = {
  key: string;
  type: ItemType;
  title: string;
  description: string;
  location: string;
  time: string;
  imageUrl: string;
};
export type EditorDay = {
  key: string;
  title: string;
  description: string;
  notes: string;
  items: EditorItem[];
};
export type EditorDoc = {
  title: string;
  destination: string;
  summary: string;
  customerId: string;
  leadId: string;
  startDate: string;
  adults: number;
  children: number;
  inclusions: string;
  exclusions: string;
  notes: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  isTemplate: boolean;
  days: EditorDay[];
};

type Loose = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const newKey = () => Math.random().toString(36).slice(2);

/** Server JSON document (or a stored snapshot) -> editor state. */
export function toEditorDoc(raw: Loose): EditorDoc {
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join("\n") : "");
  const days = Array.isArray(raw.days) ? (raw.days as Loose[]) : [];
  return {
    title: s(raw.title),
    destination: s(raw.destination),
    summary: s(raw.summary),
    customerId: s(raw.customerId),
    leadId: s(raw.leadId),
    startDate: s(raw.startDate),
    adults: typeof raw.adults === "number" ? raw.adults : 1,
    children: typeof raw.children === "number" ? raw.children : 0,
    inclusions: list(raw.inclusions),
    exclusions: list(raw.exclusions),
    notes: s(raw.notes),
    status: raw.status === "PUBLISHED" || raw.status === "ARCHIVED" ? raw.status : "DRAFT",
    isTemplate: raw.isTemplate === true,
    days: days.map((d) => ({
      key: newKey(),
      title: s(d.title),
      description: s(d.description),
      notes: s(d.notes),
      items: (Array.isArray(d.items) ? (d.items as Loose[]) : []).map((i) => ({
        key: newKey(),
        type: (ITEM_TYPES as readonly string[]).includes(s(i.type))
          ? (s(i.type) as ItemType)
          : "ACTIVITY",
        title: s(i.title),
        description: s(i.description),
        location: s(i.location),
        time: s(i.time),
        imageUrl: s(i.imageUrl),
      })),
    })),
  };
}

/** Editor state -> payload sent to the server action (validated again there). */
export function fromEditorDoc(doc: EditorDoc) {
  const splitLines = (t: string) =>
    t
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  return {
    ...doc,
    inclusions: splitLines(doc.inclusions),
    exclusions: splitLines(doc.exclusions),
    days: doc.days.map((day) => ({
      title: day.title,
      description: day.description,
      notes: day.notes,
      items: day.items.map((i) => ({
        type: i.type,
        title: i.title,
        description: i.description,
        location: i.location,
        time: i.time,
        imageUrl: i.imageUrl,
      })),
    })),
  };
}

export const newItem = (type: ItemType): EditorItem => ({
  key: newKey(),
  type,
  title: "",
  description: "",
  location: "",
  time: "",
  imageUrl: "",
});
export const newDay = (): EditorDay => ({
  key: newKey(),
  title: "",
  description: "",
  notes: "",
  items: [],
});
export const cloneDay = (d: EditorDay): EditorDay => ({
  ...d,
  key: newKey(),
  items: d.items.map((i) => ({ ...i, key: newKey() })),
});
