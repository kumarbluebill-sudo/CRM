"use client";

import { useFormAction } from "@/lib/hooks/use-form-action";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/auth/schemas";
import { generateItineraryAction } from "@/app/(app)/ai-assistant/actions";

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

export function ItineraryDraftForm({ leads }: { leads: { value: string; label: string }[] }) {
  const [leadId, setLeadId] = useState("");
  const bound = generateItineraryAction.bind(null, leadId);
  const { state, pending, formProps } = useFormAction<FormState>(bound, {});
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="it-lead" className="text-sm font-medium">
          Lead
        </label>
        <select
          id="it-lead"
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
          className={selectClass}
        >
          <option value="">Choose…</option>
          {leads.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="it-instr" className="text-sm font-medium">
          Extra instructions (optional)
        </label>
        <Textarea
          id="it-instr"
          name="instructions"
          rows={2}
          maxLength={600}
          placeholder="e.g. Relaxed pace, include a desert safari, vegetarian meals"
        />
        {state.fieldErrors?.instructions && (
          <p className="text-destructive text-xs">{state.fieldErrors.instructions[0]}</p>
        )}
      </div>
      {state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || !leadId}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {pending ? "Drafting…" : "Draft itinerary"}
        </Button>
      </div>
    </form>
  );
}
