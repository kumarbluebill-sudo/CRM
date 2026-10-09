import { GST_STATES } from "@/lib/gst/states";

export const gstStateCodes = new Set(GST_STATES.map((s) => s.code));
