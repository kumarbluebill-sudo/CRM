import type { ItemType } from "@/lib/itinerary/schema";

export type Confidence = "high" | "medium" | "low";

export type ParsedItem = {
  type: ItemType;
  title: string;
  description: string | null;
  location: string | null;
  time: string | null;
  imageUrl: null;
  confidence: Confidence;
};

export type ParsedDay = {
  title: string | null;
  description: string | null;
  notes: string | null;
  confidence: Confidence;
  items: ParsedItem[];
};

export type ParsedItinerary = {
  title: string;
  destination: string | null;
  summary: string | null;
  startDate: string | null;
  adults: number;
  children: number;
  inclusions: string[];
  exclusions: string[];
  notes: string | null;
  days: ParsedDay[];
  /** Confidence for top-level fields. */
  confidence: {
    title: Confidence;
    destination: Confidence;
    startDate: Confidence;
    travellers: Confidence;
    days: Confidence;
  };
  warnings: string[];
  /** Which engine produced the draft. */
  engine: "rules" | "openai";
};
