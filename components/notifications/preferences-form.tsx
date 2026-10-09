"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/lib/hooks/use-form-action";
import { NOTIFICATION_TYPES, TYPE_LABELS } from "@/lib/notifications/links";
import { savePreferencesAction } from "@/app/(app)/notifications/actions";
import type { FormState } from "@/lib/auth/schemas";

export function PreferencesForm({
  prefs,
}: {
  prefs: Record<string, { in_app: boolean; email: boolean }>;
}) {
  const { state, pending, formProps } = useFormAction<FormState>(savePreferencesAction, {});
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <caption className="sr-only">Notification preferences</caption>
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-1.5 font-medium">
              When…
            </th>
            <th scope="col" className="w-20 text-center font-medium">
              In the app
            </th>
            <th scope="col" className="w-20 text-center font-medium">
              By email
            </th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_TYPES.map((t) => (
            <tr key={t} className="border-b last:border-0">
              <th scope="row" className="py-2 text-left font-normal">
                {TYPE_LABELS[t]}
              </th>
              <td className="text-center">
                <input
                  type="checkbox"
                  name={`app:${t}`}
                  defaultChecked={prefs[t]?.in_app ?? true}
                  aria-label={`${TYPE_LABELS[t]}: show in the app`}
                  className="size-4 rounded border"
                />
              </td>
              <td className="text-center">
                <input
                  type="checkbox"
                  name={`email:${t}`}
                  defaultChecked={prefs[t]?.email ?? false}
                  aria-label={`${TYPE_LABELS[t]}: send by email`}
                  className="size-4 rounded border"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save preferences
        </Button>
      </div>
    </form>
  );
}
