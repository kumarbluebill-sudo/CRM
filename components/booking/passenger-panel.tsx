"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { EntityForm, type FormField } from "@/components/forms/entity-form";
import {
  addPassengerAction,
  deletePassengerAction,
  deletePassportAction,
  revealPassportAction,
  savePassportAction,
  updatePassengerAction,
} from "@/app/(app)/bookings/actions";
import { passportExpiryWarning } from "@/lib/booking/schema";

type Passenger = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  is_lead: boolean;
  special_requirements: string | null;
};
type Passport = { masked: string; expiry: string | null; country: string | null };

const REVEAL_SECONDS = 30;

const passengerFields = (p?: Passenger): FormField[] => [
  {
    name: "fullName",
    label: "Full name (as on passport)",
    required: true,
    wide: true,
    defaultValue: p?.full_name,
  },
  { name: "dateOfBirth", label: "Date of birth", type: "date", defaultValue: p?.date_of_birth },
  {
    name: "gender",
    label: "Gender",
    type: "select",
    options: [
      { value: "MALE", label: "Male" },
      { value: "FEMALE", label: "Female" },
      { value: "OTHER", label: "Other" },
    ],
    defaultValue: p?.gender,
  },
  { name: "nationality", label: "Nationality", defaultValue: p?.nationality },
  {
    name: "specialRequirements",
    label: "Special requirements",
    type: "textarea",
    defaultValue: p?.special_requirements,
  },
];

export function PassengerPanel({
  bookingId,
  passengers,
  passports,
  canEdit,
  canSensitive,
  travelEnd,
}: {
  bookingId: string;
  passengers: Passenger[];
  passports: Record<string, Passport>;
  canEdit: boolean;
  canSensitive: boolean;
  travelEnd: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {passengers.map((p) => (
        <PassengerCard
          key={p.id}
          bookingId={bookingId}
          p={p}
          passport={passports[p.id]}
          canEdit={canEdit}
          canSensitive={canSensitive}
          travelEnd={travelEnd}
        />
      ))}
      {canEdit && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Add passenger</summary>
          <div className="pt-3">
            <EntityForm
              action={addPassengerAction.bind(null, bookingId)}
              submitLabel="Add passenger"
              fields={passengerFields()}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function PassengerCard({
  bookingId,
  p,
  passport,
  canEdit,
  canSensitive,
  travelEnd,
}: {
  bookingId: string;
  p: Passenger;
  passport?: Passport;
  canEdit: boolean;
  canSensitive: boolean;
  travelEnd: string | null;
}) {
  const warning = passport ? passportExpiryWarning(passport.expiry, travelEnd) : null;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {p.full_name}{" "}
            {p.is_lead && (
              <span className="text-muted-foreground text-xs font-normal">(lead passenger)</span>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            {[p.gender?.toLowerCase(), p.nationality, p.date_of_birth]
              .filter(Boolean)
              .join(" · ") || "No details yet"}
          </p>
          {p.special_requirements && (
            <p className="mt-1 text-xs">Needs: {p.special_requirements}</p>
          )}
        </div>
        {canEdit && !p.is_lead && (
          <ConfirmActionButton
            action={deletePassengerAction.bind(null, p.id, bookingId)}
            triggerLabel="Remove"
            title={`Remove ${p.full_name}?`}
            description="Their details, including any passport information, will be deleted."
          />
        )}
      </div>

      {canSensitive && (
        <div className="mt-3 rounded-md border bg-amber-50/50 p-2 dark:bg-amber-950/20">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase">
            <ShieldCheck className="size-3.5" aria-hidden /> Passport (restricted)
          </p>
          {passport ? (
            <PassportRow
              passengerId={p.id}
              bookingId={bookingId}
              passport={passport}
              warning={warning}
              canEdit={canEdit}
            />
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">No passport on file.</p>
          )}
          {canEdit && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">
                {passport ? "Replace passport details" : "Add passport details"}
              </summary>
              <div className="pt-2">
                <EntityForm
                  action={savePassportAction.bind(null, p.id, bookingId)}
                  submitLabel="Save passport"
                  fields={[
                    { name: "passportNumber", label: "Passport number", required: true },
                    {
                      name: "passportExpiry",
                      label: "Expiry date",
                      type: "date",
                      defaultValue: passport?.expiry,
                    },
                    {
                      name: "passportCountry",
                      label: "Issuing country",
                      defaultValue: passport?.country,
                    },
                  ]}
                />
              </div>
            </details>
          )}
        </div>
      )}

      {canEdit && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">Edit details</summary>
          <div className="pt-2">
            <EntityForm
              action={updatePassengerAction.bind(null, p.id, bookingId)}
              submitLabel="Save"
              fields={passengerFields(p)}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function PassportRow({
  passengerId,
  bookingId,
  passport,
  warning,
  canEdit,
}: {
  passengerId: string;
  bookingId: string;
  passport: Passport;
  warning: string | null;
  canEdit: boolean;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [pending, start] = useTransition();

  // The revealed number disappears automatically.
  useEffect(() => {
    if (!shown) return;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    const hide = setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
    return () => {
      clearInterval(t);
      clearTimeout(hide);
    };
  }, [shown]);

  return (
    <div className="mt-1 flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{shown ?? passport.masked}</span>
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() =>
            shown
              ? setShown(null)
              : start(async () => {
                  const r = await revealPassportAction(passengerId);
                  if (r.ok && r.number) {
                    setLeft(REVEAL_SECONDS);
                    setShown(r.number);
                  } else toast.error(r.message ?? "Could not reveal.");
                })
          }
        >
          {shown ? (
            <>
              <EyeOff className="size-3.5" aria-hidden /> Hide ({left}s)
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden /> Reveal (logged)
            </>
          )}
        </Button>
        {canEdit && (
          <ConfirmActionButton
            action={deletePassportAction.bind(null, passengerId, bookingId)}
            triggerLabel="Delete"
            title="Delete passport details?"
            description="The passport number and expiry will be permanently removed."
          />
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {passport.country ?? "Country not set"} · expires {passport.expiry ?? "unknown"}
      </p>
      {warning && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle className="size-3.5" aria-hidden /> {warning}
        </p>
      )}
    </div>
  );
}
