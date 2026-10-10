import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  DATE_FORMATS,
  DEFAULT_PREFS,
  isValidTimeZone,
  type DateFormat,
  type DisplayPrefs,
  type TimeFormat,
} from "@/lib/datetime/format";

const pickDate = (v: unknown): DateFormat | undefined => DATE_FORMATS.find((f) => f === v);
const pickTime = (v: unknown): TimeFormat | undefined =>
  v === "12h" || v === "24h" ? v : undefined;

/**
 * How dates and times are shown to the signed-in person. Time zone: their own setting, else their branch, else the
 * agency default. Formats: their own, else the agency default. Falls back to safe defaults if anything is missing.
 */
export const getDisplayPrefs = cache(async (): Promise<DisplayPrefs> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return DEFAULT_PREFS;
    const [{ data: profile }, { data: member }, { data: org }] = await Promise.all([
      supabase
        .from("profiles")
        .select("timezone, date_format, time_format, week_start")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("branches ( timezone )")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("organization_settings")
        .select("timezone, date_format, time_format, week_start")
        .maybeSingle(),
    ]);
    const branch = Array.isArray(member?.branches) ? member?.branches[0] : member?.branches;
    const tz = [profile?.timezone, branch?.timezone, org?.timezone].find(isValidTimeZone);
    return {
      timeZone: tz ?? DEFAULT_PREFS.timeZone,
      dateFormat:
        pickDate(profile?.date_format) ?? pickDate(org?.date_format) ?? DEFAULT_PREFS.dateFormat,
      timeFormat:
        pickTime(profile?.time_format) ?? pickTime(org?.time_format) ?? DEFAULT_PREFS.timeFormat,
      weekStart: profile?.week_start ?? org?.week_start ?? DEFAULT_PREFS.weekStart,
    };
  } catch {
    return DEFAULT_PREFS;
  }
});
