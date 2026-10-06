"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

export type FormField = {
  name: string;
  label: string;
  type?:
    "text" | "password" | "email" | "tel" | "number" | "date" | "textarea" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean | null;
  required?: boolean;
  placeholder?: string;
  /** Spans both columns on wide screens. */
  wide?: boolean;
  min?: number;
  step?: string;
};

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: FormField[];
  submitLabel: string;
  /** Non-editable values sent with the form (e.g. the record a task links to). Always re-validated server-side. */
  hidden?: Record<string, string>;
};

/** Validated-on-server form with field errors, pending state and success/failure messages. */
export function EntityForm({ action, fields, submitLabel, hidden }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {hidden &&
        Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const errors = state.fieldErrors?.[f.name];
          const errId = `${f.name}-error`;
          const common = {
            id: f.name,
            name: f.name,
            "aria-invalid": errors ? true : undefined,
            "aria-describedby": errors ? errId : undefined,
          } as const;
          const type = f.type ?? "text";
          const dv = f.defaultValue ?? undefined;

          return (
            <div
              key={f.name}
              className={cn(
                "flex flex-col gap-1.5",
                (f.wide || type === "textarea") && "sm:col-span-2",
              )}
            >
              {type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    {...common}
                    type="checkbox"
                    defaultChecked={Boolean(dv)}
                    className="size-4 rounded border"
                  />
                  {f.label}
                </label>
              ) : (
                <>
                  <label htmlFor={f.name} className="text-sm font-medium">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </label>
                  {type === "textarea" ? (
                    <Textarea
                      {...common}
                      rows={3}
                      defaultValue={dv as string}
                      placeholder={f.placeholder}
                    />
                  ) : type === "select" ? (
                    <select {...common} defaultValue={(dv as string) ?? ""} className={selectClass}>
                      {!f.required && <option value="">—</option>}
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      {...common}
                      type={type}
                      defaultValue={dv as string}
                      placeholder={f.placeholder}
                      min={f.min}
                      step={f.step}
                      autoComplete={type === "password" ? "off" : undefined}
                    />
                  )}
                </>
              )}
              {errors && (
                <p id={errId} className="text-destructive text-xs">
                  {errors[0]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok ? "text-sm text-green-700 dark:text-green-400" : "text-destructive text-sm"
          }
        >
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
