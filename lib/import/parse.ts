import type { ItemType } from "@/lib/itinerary/schema";
import { MAX_DAYS, MAX_ITEMS_PER_DAY } from "@/lib/itinerary/schema";
import type { Confidence, ParsedDay, ParsedItem, ParsedItinerary } from "@/lib/import/types";

/**
 * Deterministic, rule-based itinerary parser. It only restructures text that is
 * present in the document and never invents data. Document text is treated purely
 * as data: nothing in it is executed or interpreted as an instruction.
 */

const MAX_TEXT = 200_000;
const INJECTION =
  /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)|system\s+prompt|you\s+are\s+now\s+(an?\s+)?(ai|assistant|chatgpt)|reveal\s+(your|the)\s+(prompt|instructions)/i;

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

const DAY_HEADING = /^\s*(?:day|d)\s*[-:.#]?\s*(\d{1,2})\b\s*[:\-–—.|]?\s*(.*)$/i;
const BULLET = /^\s*(?:[•●▪■◦○\-*–—>]+|\d{1,2}[.)])\s+/;
const INCL =
  /^\s*(?:package\s+)?(inclusions?|includes?|what'?s\s+included|cost\s+includes?)\s*:?\s*$/i;
const EXCL =
  /^\s*(?:package\s+)?(exclusions?|excludes?|not\s+included|what'?s\s+not\s+included|cost\s+excludes?)\s*:?\s*$/i;
const NOTES_HEAD =
  /^\s*(terms(?:\s+and\s+conditions)?|notes?|important\s+notes?|cancellation\s+policy)\s*:?\s*$/i;
const ANY_SECTION =
  /^\s*(itinerary|day[-\s]?wise|highlights|price|cost|payment\s+policy)\s*:?\s*$/i;

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";

function toIsoDate(text: string): string | null {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})[a-z]*\\.?,?\\s+(\\d{4})\\b`, "i"),
  );
  if (m) return valid(+m[3], monthIndex(m[2]), +m[1]);
  return null;
}
function monthIndex(name: string) {
  return (
    (MONTHS.split("|").findIndex((x) => name.toLowerCase().startsWith(x === "sept" ? "sep" : x)) %
      12) +
    1
  );
}
function valid(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

function toTime(line: string): { time: string | null; rest: string } {
  const m = line.match(/^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|hrs|hours)?\s*[-–—:]?\s+(.*)$/i);
  if (!m) return { time: null, rest: line };
  const hasMinutes = m[2] !== undefined;
  const suffix = m[3]?.toLowerCase();
  if (!hasMinutes && !suffix) return { time: null, rest: line };
  let h = +m[1];
  const min = hasMinutes ? +m[2] : 0;
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return { time: null, rest: line };
  return { time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, rest: m[4] };
}

function classify(line: string): { type: ItemType; confidence: Confidence } {
  const l = line.toLowerCase();
  if (/^(note|please|kindly|important)\b/.test(l)) return { type: "NOTE", confidence: "high" };
  if (/\bflight\b|\bairlines?\b|\bboarding\b|\b[a-z0-9]{2}\s?\d{2,4}\b.*\b(dep|arr)/.test(l))
    return { type: "FLIGHT", confidence: "medium" };
  // Precedence matters: "transfer to hotel" is a transfer; "dinner at hotel" is a meal.
  const labelled = /^(hotel|resort|stay)\s*:/.test(l);
  if (labelled || /\b(check[- ]?in|overnight|accommodation|stay at)\b/.test(l))
    return { type: "HOTEL", confidence: labelled ? "high" : "medium" };
  if (
    /\b(transfers?|pick[- ]?up|drop[- ]?off|drop|airport|coach|cab|ferry|drive to|private car)\b/.test(
      l,
    )
  )
    return { type: "TRANSFER", confidence: "medium" };
  if (/\b(breakfast|lunch|dinner|brunch|buffet|meals?)\b/.test(l))
    return { type: "MEAL", confidence: "medium" };
  if (/\b(hotel|resort|villa|lodge|check[- ]?out)\b/.test(l))
    return { type: "HOTEL", confidence: "medium" };
  return { type: "ACTIVITY", confidence: "medium" };
}

function cleanLine(line: string) {
  return line.replace(BULLET, "").trim();
}

function splitTitle(text: string): { title: string; description: string | null } {
  if (text.length <= 120) return { title: text, description: null };
  const cut = text.slice(0, 120);
  const idx = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  const title = (idx > 40 ? cut.slice(0, idx) : cut).replace(/[.,]$/, "");
  return { title, description: text.slice(title.length).replace(/^[.,\s]+/, "") || null };
}

function parseItem(rawLine: string): ParsedItem | null {
  const stripped = cleanLine(rawLine);
  if (!stripped || /^[-_=*•\s]+$/.test(stripped)) return null;
  const { time, rest } = toTime(stripped);
  const labeled = rest.match(
    /^(hotel|resort|stay|transfer|activity|meal|flight|note)\s*:\s*(.+)$/i,
  );
  const body = (labeled ? labeled[2] : rest).trim();
  if (!body) return null;
  const cls = classify(labeled ? `${labeled[1]}: ${body}` : body);
  const { title, description } = splitTitle(body);
  return {
    type: cls.type,
    title,
    description,
    location: null,
    time,
    imageUrl: null,
    confidence: cls.confidence,
  };
}

export function parseItineraryText(input: string): ParsedItinerary {
  const warnings: string[] = [];
  const text = normalizeText(input);
  const allLines = text.split("\n");

  // Drop instruction-like lines; they are data, but never carried into the draft.
  let removed = 0;
  const lines = allLines.filter((l) => {
    if (INJECTION.test(l)) {
      removed++;
      return false;
    }
    return true;
  });
  if (removed > 0)
    warnings.push(`${removed} instruction-like line(s) in the document were ignored.`);

  // Locate day headings.
  const dayStarts: { index: number; num: number; title: string }[] = [];
  lines.forEach((line, index) => {
    const m = line.match(DAY_HEADING);
    if (m && line.trim().length < 160) dayStarts.push({ index, num: +m[1], title: m[2].trim() });
  });

  const firstNonEmpty = lines.findIndex((l) => l.trim() !== "");
  const firstDay = dayStarts[0]?.index ?? (firstNonEmpty === -1 ? lines.length : firstNonEmpty + 1);
  const header = lines.slice(0, firstDay);

  // Title.
  const titleLine = header
    .map((l) => l.trim())
    .find((l) => l && !INCL.test(l) && !ANY_SECTION.test(l) && l.length <= 140);
  const title = titleLine ? cleanLine(titleLine).slice(0, 200) : "Imported itinerary";
  const titleConf: Confidence = titleLine ? "medium" : "low";

  // Destination.
  let destination: string | null = null;
  let destConf: Confidence = "low";
  const labelled = text.match(/^\s*(?:destinations?|trip\s+to|location)\s*[:\-–]\s*(.+)$/im);
  if (labelled) {
    destination = labelled[1].trim().slice(0, 200);
    destConf = "high";
  } else if (titleLine) {
    const fromTitle = title.match(
      /^(.*?)\s+(?:tour|package|trip|itinerary|holiday|vacation|honeymoon|getaway)\b/i,
    );
    if (fromTitle && fromTitle[1].trim().length >= 3) {
      destination =
        fromTitle[1]
          .replace(/^\d+\s*[nd]\s*[/&-]?\s*\d*\s*[nd]?\s*/i, "")
          .trim()
          .slice(0, 200) || null;
      destConf = destination ? "medium" : "low";
    }
  }

  // Dates, travellers, duration.
  const dateLine = text.match(
    /(?:start(?:ing)?\s+date|travel\s+date|date\s+of\s+travel|departure(?:\s+date)?|dates?)\s*[:\-–]\s*([^\n]+)/i,
  );
  const startDate = dateLine ? toIsoDate(dateLine[1]) : null;
  const adults = text.match(/(\d{1,3})\s*(?:adults?|pax)\b/i);
  const kids = text.match(/(\d{1,3})\s*(?:child(?:ren)?|kids?)\b/i);
  const travConf: Confidence = adults ? "medium" : "low";
  const dur = text.match(/(\d{1,2})\s*n(?:ights?)?\s*[/&-]?\s*(\d{1,2})\s*d(?:ays?)?/i);

  // Days.
  const days: ParsedDay[] = [];
  dayStarts.forEach((start, i) => {
    const end = dayStarts[i + 1]?.index ?? lines.length;
    const body = lines.slice(start.index + 1, end);
    // Stop the last day at an inclusion/exclusion/notes section.
    const stop = body.findIndex((l) => INCL.test(l) || EXCL.test(l) || NOTES_HEAD.test(l));
    const dayLines = stop === -1 ? body : body.slice(0, stop);

    const items: ParsedItem[] = [];
    const prose: string[] = [];
    for (const l of dayLines) {
      const clean = cleanLine(l);
      if (!clean) continue;
      const isBullet = BULLET.test(l);
      if (
        !isBullet &&
        clean.length > 160 &&
        classify(clean).type === "ACTIVITY" &&
        items.length === 0
      ) {
        prose.push(clean);
        continue;
      }
      const item = parseItem(l);
      if (item) items.push(item);
    }
    if (items.length > MAX_ITEMS_PER_DAY) {
      warnings.push(`Day ${start.num}: only the first ${MAX_ITEMS_PER_DAY} items were kept.`);
      items.length = MAX_ITEMS_PER_DAY;
    }
    days.push({
      title: start.title ? start.title.slice(0, 200) : null,
      description: prose.join("\n").slice(0, 5000) || null,
      notes: null,
      confidence: items.length > 0 ? "medium" : "low",
      items,
    });
  });

  let daysConf: Confidence = "medium";
  if (days.length === 0) {
    daysConf = "low";
    const body = lines
      .slice(firstDay)
      .map((l) => parseItem(l))
      .filter((x): x is ParsedItem => x !== null);
    if (body.length) {
      days.push({
        title: null,
        description: null,
        notes: null,
        confidence: "low",
        items: body.slice(0, MAX_ITEMS_PER_DAY),
      });
      warnings.push(
        "No “Day 1, Day 2…” headings were found. Everything was placed on Day 1; please split it into days.",
      );
    } else {
      warnings.push("No itinerary content could be recognised in this document.");
    }
  } else {
    const nums = dayStarts.map((d) => d.num);
    const sequential = nums.every((n, i) => n === i + 1);
    if (!sequential) {
      warnings.push(
        "Day numbers in the document are not sequential; days were renumbered in order.",
      );
      daysConf = "low";
    }
    if (dur && days.length !== +dur[2]) {
      warnings.push(
        `The document mentions ${dur[2]} days but ${days.length} day headings were found.`,
      );
      daysConf = "low";
    }
  }
  if (days.length > MAX_DAYS) {
    days.length = MAX_DAYS;
    warnings.push(`Only the first ${MAX_DAYS} days were kept.`);
  }

  // Sections.
  const section = (head: RegExp): string[] => {
    const at = lines.findIndex((l) => head.test(l));
    if (at === -1) return [];
    const out: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (
        INCL.test(l) ||
        EXCL.test(l) ||
        NOTES_HEAD.test(l) ||
        DAY_HEADING.test(l) ||
        ANY_SECTION.test(l)
      )
        break;
      const c = cleanLine(l);
      if (c) out.push(c.slice(0, 300));
      if (out.length >= 100) break;
    }
    return out;
  };
  const inclusions = section(INCL);
  const exclusions = section(EXCL);
  const notesText = section(NOTES_HEAD).join("\n").slice(0, 5000) || null;

  const summary =
    header
      .map((l) => l.trim())
      .filter((l) => l && l !== titleLine && l.length > 60)
      .join(" ")
      .slice(0, 2000) || null;

  return {
    title,
    destination,
    summary,
    startDate,
    adults: adults ? Math.min(+adults[1], 200) : 1,
    children: kids ? Math.min(+kids[1], 200) : 0,
    inclusions,
    exclusions,
    notes: notesText,
    days,
    confidence: {
      title: titleConf,
      destination: destConf,
      startDate: startDate ? "medium" : "low",
      travellers: travConf,
      days: daysConf,
    },
    warnings,
    engine: "rules",
  };
}

export type FlaggedEntry = { where: string; text: string; confidence: Confidence; kind: string };

/** Everything a reviewer should double-check (anything below "high"), most uncertain first. */
export function flaggedEntries(p: ParsedItinerary): FlaggedEntry[] {
  const out: FlaggedEntry[] = [];
  const top: [string, Confidence, string][] = [
    ["Title", p.confidence.title, p.title],
    ["Destination", p.confidence.destination, p.destination ?? "(not found)"],
    ["Start date", p.confidence.startDate, p.startDate ?? "(not found)"],
    ["Travellers", p.confidence.travellers, `${p.adults} adults, ${p.children} children`],
  ];
  for (const [kind, confidence, text] of top) {
    if (confidence !== "high") out.push({ where: "Trip", text, confidence, kind });
  }
  p.days.forEach((d, i) => {
    if (d.confidence === "low")
      out.push({
        where: `Day ${i + 1}`,
        text: d.title ?? "(no title)",
        confidence: "low",
        kind: "Day",
      });
    d.items.forEach((it) => {
      if (it.confidence !== "high")
        out.push({
          where: `Day ${i + 1}`,
          text: it.title,
          confidence: it.confidence,
          kind: it.type.toLowerCase(),
        });
    });
  });
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}
