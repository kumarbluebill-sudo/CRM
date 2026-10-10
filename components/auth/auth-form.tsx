"use client";

import { useFormAction } from "@/lib/hooks/use-form-action";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";

export type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  placeholder?: string;
  optional?: boolean;
};

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Field[];
  submitLabel: string;
};

/** Generic form: field-level errors, pending state (blocks double submit), success/failure message. */
export function AuthForm({ action, fields, submitLabel }: Props) {
  const { state, pending, formProps } = useFormAction<FormState>(action, {});

  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      {fields.map((f) => {
        const errors = state.fieldErrors?.[f.name];
        const errId = `${f.name}-error`;
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label htmlFor={f.name} className="text-sm font-medium">
              {f.label}
            </label>
            <Input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              defaultValue={f.defaultValue}
              placeholder={f.placeholder}
              aria-invalid={errors ? true : undefined}
              aria-describedby={errors ? errId : undefined}
              required={!f.optional}
            />
            {errors && (
              <p id={errId} className="text-destructive text-xs">
                {errors[0]}
              </p>
            )}
          </div>
        );
      })}
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-tone-ok text-sm" : "text-destructive text-sm"}
        >
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {submitLabel}
      </Button>
    </form>
  );
}
