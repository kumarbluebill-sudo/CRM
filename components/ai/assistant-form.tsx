"use client";

import { useFormAction } from "@/lib/hooks/use-form-action";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { runAssistantAction, type AssistantState } from "@/app/(app)/ai-assistant/actions";

type Opt = { value: string; label: string };
const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

export function AssistantForm({
  bookings,
  leads,
  initialType,
  initialId,
}: {
  bookings: Opt[];
  leads: Opt[];
  initialType: "BOOKING" | "LEAD";
  initialId?: string;
}) {
  const { state, pending, formProps } = useFormAction<AssistantState>(runAssistantAction, {});
  const [type, setType] = useState(initialType);
  const [task, setTask] = useState("SUMMARIZE");
  const [copied, setCopied] = useState(false);
  const options = type === "BOOKING" ? bookings : leads;
  const err = (k: string) => state.fieldErrors?.[k]?.[0];

  return (
    <div className="flex flex-col gap-4">
      <form {...formProps} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-type" className="text-sm font-medium">
              About a
            </label>
            <select
              id="ai-type"
              name="entityType"
              value={type}
              onChange={(e) => setType(e.target.value as "BOOKING" | "LEAD")}
              className={selectClass}
            >
              <option value="BOOKING">Booking</option>
              <option value="LEAD">Lead</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="ai-entity" className="text-sm font-medium">
              Record
            </label>
            <select
              id="ai-entity"
              name="entityId"
              key={type}
              defaultValue={type === initialType ? initialId : undefined}
              className={selectClass}
              required
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {err("entityId") && <p className="text-destructive text-xs">Choose a record.</p>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ai-task" className="text-sm font-medium">
            What do you need?
          </label>
          <select
            id="ai-task"
            name="task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            className={selectClass}
          >
            <option value="SUMMARIZE">Summarise and suggest next steps</option>
            <option value="DRAFT_MESSAGE">Draft a message to the customer</option>
            <option value="ASK">Ask a question about it</option>
          </select>
        </div>

        {task === "DRAFT_MESSAGE" && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-channel" className="text-sm font-medium">
                Channel
              </label>
              <select id="ai-channel" name="channel" defaultValue="EMAIL" className={selectClass}>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-intent" className="text-sm font-medium">
                What should the message do?
              </label>
              <Textarea
                id="ai-intent"
                name="intent"
                rows={2}
                maxLength={300}
                placeholder="e.g. Remind them the second instalment is due and offer to answer questions"
              />
              {err("intent") && <p className="text-destructive text-xs">{err("intent")}</p>}
            </div>
          </>
        )}
        {task === "ASK" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-question" className="text-sm font-medium">
              Your question
            </label>
            <Input id="ai-question" name="question" maxLength={500} />
            {err("question") && <p className="text-destructive text-xs">{err("question")}</p>}
          </div>
        )}

        {state.message && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {pending ? "Thinking…" : "Ask AI"}
          </Button>
        </div>
      </form>

      {state.text && (
        <section aria-label="AI response" className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            AI-generated. Check every fact against the record before you use it. Nothing has been
            sent or changed.
          </p>
          <p className="text-sm whitespace-pre-wrap">{state.text}</p>
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.text ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* clipboard unavailable: the text is still selectable */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
