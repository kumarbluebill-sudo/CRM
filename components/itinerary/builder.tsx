"use client";

import { LocalTime } from "@/components/datetime/local-time";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bed,
  Bus,
  Copy,
  Eye,
  History,
  MapPin,
  Plane,
  Plus,
  Save,
  StickyNote,
  Trash2,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveItineraryAction } from "@/app/(app)/itineraries/actions";
import { label } from "@/lib/crm/constants";
import {
  cloneDay,
  fromEditorDoc,
  ITEM_TYPES,
  MAX_DAYS,
  MAX_ITEMS_PER_DAY,
  newDay,
  newItem,
  toEditorDoc,
  type EditorDay,
  type EditorDoc,
  type EditorItem,
  type ItemType,
} from "@/lib/itinerary/schema";

const TYPE_META: Record<ItemType, { icon: LucideIcon; hint: string }> = {
  ACTIVITY: { icon: MapPin, hint: "Sightseeing, tour, experience" },
  HOTEL: { icon: Bed, hint: "Hotel and room type" },
  TRANSFER: { icon: Bus, hint: "Pickup, drop, transport" },
  MEAL: { icon: Utensils, hint: "Breakfast, lunch, dinner" },
  FLIGHT: { icon: Plane, hint: "Flight number, timing" },
  NOTE: { icon: StickyNote, hint: "Reminder or note" },
};

type Version = {
  id: string;
  version_number: number;
  label: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
};

type Props = {
  id: string;
  initial: Record<string, unknown>;
  versions: Version[];
  canEdit: boolean;
  /** Imported content that a person has not yet confirmed; publishing is blocked. */
  needsReview?: boolean;
};

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ItineraryBuilder({ id, initial, versions, canEdit, needsReview }: Props) {
  const [doc, setDoc] = useState<EditorDoc>(() => toEditorDoc(initial));
  const [version, setVersion] = useState<number>(Number(initial.version ?? 1));
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const edit = (fn: (d: EditorDoc) => EditorDoc) => {
    setDoc((d) => fn(d));
    setDirty(true);
  };
  const setField = <K extends keyof EditorDoc>(key: K, value: EditorDoc[K]) =>
    edit((d) => ({ ...d, [key]: value }));
  const setDay = (di: number, fn: (d: EditorDay) => EditorDay) =>
    edit((d) => ({ ...d, days: d.days.map((x, i) => (i === di ? fn(x) : x)) }));
  const setItem = (di: number, ii: number, patch: Partial<EditorItem>) =>
    setDay(di, (day) => ({
      ...day,
      items: day.items.map((x, i) => (i === ii ? { ...x, ...patch } : x)),
    }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const dayDates = useMemo(() => {
    if (!doc.startDate) return doc.days.map(() => "");
    const start = new Date(`${doc.startDate}T00:00:00`);
    return doc.days.map((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    });
  }, [doc.startDate, doc.days]);

  function save(opts: { publish?: boolean; snapshot?: boolean; label?: string } = {}) {
    const next: EditorDoc = {
      ...doc,
      status: opts.publish ? "PUBLISHED" : doc.isTemplate ? "DRAFT" : doc.status,
    };
    start(async () => {
      const res = await saveItineraryAction(id, version, fromEditorDoc(next), {
        snapshot: opts.snapshot,
        label: opts.label,
      });
      if (res.ok && res.version) {
        setVersion(res.version);
        setDoc(next);
        setDirty(false);
        setProblems([]);
        toast.success(opts.publish ? "Published" : opts.snapshot ? "Version saved" : "Draft saved");
      } else {
        setProblems(res.fieldErrors ?? []);
        toast.error(res.message ?? "Could not save.");
      }
    });
  }

  const ro = !canEdit;
  const totalItems = doc.days.reduce((n, d) => n + d.items.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-card sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <span className="text-sm font-medium">
          {doc.status === "PUBLISHED" ? "Published" : "Draft"} · v{version}
          {dirty && <span className="text-tone-warn"> · unsaved changes</span>}
        </span>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/itineraries/${id}/preview`} />}
        >
          <Eye className="size-4" aria-hidden /> Preview
        </Button>
        <HistoryDialog
          versions={versions}
          disabled={ro}
          onRestore={(snap) => {
            edit(() => ({ ...toEditorDoc(snap), status: "DRAFT" }));
            toast.message("Version loaded. Review it, then save.");
          }}
        />
        {!ro && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => save({ snapshot: true, label: "Manual snapshot" })}
            >
              Save version
            </Button>
            <Button variant="outline" size="sm" disabled={pending || !dirty} onClick={() => save()}>
              <Save className="size-4" aria-hidden /> Save draft
            </Button>
            {!doc.isTemplate && (
              <Button
                size="sm"
                disabled={pending || needsReview}
                title={needsReview ? "Confirm the review first" : undefined}
                onClick={() => save({ publish: true })}
              >
                Publish
              </Button>
            )}
          </>
        )}
      </div>

      {problems.length > 0 && (
        <ul
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive list-disc rounded-lg border p-3 pl-7 text-sm"
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <section className="bg-card grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
        <Field label="Title" wide>
          <Input
            disabled={ro}
            value={doc.title}
            onChange={(e) => setField("title", e.target.value)}
          />
        </Field>
        <Field label="Destination">
          <Input
            disabled={ro}
            value={doc.destination}
            onChange={(e) => setField("destination", e.target.value)}
          />
        </Field>
        <Field label="Start date">
          <Input
            disabled={ro}
            type="date"
            value={doc.startDate}
            onChange={(e) => setField("startDate", e.target.value)}
          />
        </Field>
        <Field label="Adults">
          <Input
            disabled={ro}
            type="number"
            min={0}
            value={doc.adults}
            onChange={(e) => setField("adults", Number(e.target.value))}
          />
        </Field>
        <Field label="Children">
          <Input
            disabled={ro}
            type="number"
            min={0}
            value={doc.children}
            onChange={(e) => setField("children", Number(e.target.value))}
          />
        </Field>
        <Field label="Summary" wide>
          <Textarea
            disabled={ro}
            rows={3}
            value={doc.summary}
            onChange={(e) => setField("summary", e.target.value)}
            placeholder="A short overview shown at the top of the itinerary."
          />
        </Field>
      </section>

      <section aria-label="Days" className="flex flex-col gap-4">
        {doc.days.map((day, di) => (
          <article key={day.key} className="bg-card rounded-xl border">
            <header className="flex flex-wrap items-center gap-2 border-b p-3">
              <h2 className="text-sm font-semibold">
                Day {di + 1}
                {dayDates[di] && (
                  <span className="text-muted-foreground font-normal"> · {dayDates[di]}</span>
                )}
              </h2>
              <Input
                disabled={ro}
                aria-label={`Day ${di + 1} title`}
                className="min-w-48 flex-1"
                placeholder="Day title, e.g. Arrival & city tour"
                value={day.title}
                onChange={(e) => setDay(di, (d) => ({ ...d, title: e.target.value }))}
              />
              {!ro && (
                <div className="flex gap-1">
                  <IconButton
                    label="Move day up"
                    disabled={di === 0}
                    onClick={() => edit((d) => ({ ...d, days: move(d.days, di, di - 1) }))}
                  >
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Move day down"
                    disabled={di === doc.days.length - 1}
                    onClick={() => edit((d) => ({ ...d, days: move(d.days, di, di + 1) }))}
                  >
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Duplicate day"
                    disabled={doc.days.length >= MAX_DAYS}
                    onClick={() =>
                      edit((d) => ({
                        ...d,
                        days: [...d.days.slice(0, di + 1), cloneDay(day), ...d.days.slice(di + 1)],
                      }))
                    }
                  >
                    <Copy className="size-4" />
                  </IconButton>
                  <DeleteConfirm
                    what={`Day ${di + 1}`}
                    count={day.items.length}
                    onConfirm={() =>
                      edit((d) => ({ ...d, days: d.days.filter((_, i) => i !== di) }))
                    }
                  />
                </div>
              )}
            </header>

            <div className="flex flex-col gap-3 p-3">
              <Textarea
                disabled={ro}
                rows={2}
                aria-label={`Day ${di + 1} description`}
                placeholder="What happens today?"
                value={day.description}
                onChange={(e) => setDay(di, (d) => ({ ...d, description: e.target.value }))}
              />

              {day.items.map((item, ii) => {
                const Icon = TYPE_META[item.type].icon;
                return (
                  <div
                    key={item.key}
                    className="bg-muted/40 grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_auto]"
                  >
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase sm:flex-col sm:items-start">
                      <Icon className="size-4" aria-hidden /> {label(item.type)}
                    </span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        disabled={ro}
                        aria-label="Item title"
                        placeholder="Title *"
                        value={item.title}
                        onChange={(e) => setItem(di, ii, { title: e.target.value })}
                        className="sm:col-span-2"
                      />
                      <Input
                        disabled={ro}
                        aria-label="Location"
                        placeholder="Location"
                        value={item.location}
                        onChange={(e) => setItem(di, ii, { location: e.target.value })}
                      />
                      <Input
                        disabled={ro}
                        aria-label="Time"
                        type="time"
                        value={item.time}
                        onChange={(e) => setItem(di, ii, { time: e.target.value })}
                      />
                      <Textarea
                        disabled={ro}
                        aria-label="Details"
                        rows={2}
                        placeholder={TYPE_META[item.type].hint}
                        value={item.description}
                        onChange={(e) => setItem(di, ii, { description: e.target.value })}
                        className="sm:col-span-2"
                      />
                      <Input
                        disabled={ro}
                        aria-label="Image URL"
                        placeholder="Image URL (https://…)"
                        value={item.imageUrl}
                        onChange={(e) => setItem(di, ii, { imageUrl: e.target.value })}
                        className="sm:col-span-2"
                      />
                    </div>
                    {!ro && (
                      <div className="flex gap-1 sm:flex-col">
                        <IconButton
                          label="Move item up"
                          disabled={ii === 0}
                          onClick={() =>
                            setDay(di, (d) => ({ ...d, items: move(d.items, ii, ii - 1) }))
                          }
                        >
                          <ArrowUp className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Move item down"
                          disabled={ii === day.items.length - 1}
                          onClick={() =>
                            setDay(di, (d) => ({ ...d, items: move(d.items, ii, ii + 1) }))
                          }
                        >
                          <ArrowDown className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Delete item"
                          onClick={() =>
                            setDay(di, (d) => ({ ...d, items: d.items.filter((_, i) => i !== ii) }))
                          }
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                );
              })}

              {!ro && (
                <div className="flex flex-wrap gap-2">
                  {ITEM_TYPES.map((t) => {
                    const Icon = TYPE_META[t].icon;
                    return (
                      <Button
                        key={t}
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={day.items.length >= MAX_ITEMS_PER_DAY}
                        onClick={() =>
                          setDay(di, (d) => ({ ...d, items: [...d.items, newItem(t)] }))
                        }
                      >
                        <Icon className="size-3.5" aria-hidden /> {label(t)}
                      </Button>
                    );
                  })}
                </div>
              )}
              <Input
                disabled={ro}
                aria-label={`Day ${di + 1} notes`}
                placeholder="Internal/day notes (shown on the itinerary)"
                value={day.notes}
                onChange={(e) => setDay(di, (d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </article>
        ))}

        {doc.days.length === 0 && (
          <p className="text-muted-foreground bg-card rounded-xl border p-8 text-center text-sm">
            No days yet. Add the first day to start building.
          </p>
        )}
        {!ro && (
          <div>
            <Button
              variant="outline"
              disabled={doc.days.length >= MAX_DAYS}
              onClick={() => edit((d) => ({ ...d, days: [...d.days, newDay()] }))}
            >
              <Plus className="size-4" aria-hidden /> Add day
            </Button>
            <span className="text-muted-foreground ml-3 text-xs">
              {doc.days.length} days · {totalItems} items
            </span>
          </div>
        )}
      </section>

      <section className="bg-card grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
        <Field label="Inclusions (one per line)">
          <Textarea
            disabled={ro}
            rows={5}
            value={doc.inclusions}
            onChange={(e) => setField("inclusions", e.target.value)}
          />
        </Field>
        <Field label="Exclusions (one per line)">
          <Textarea
            disabled={ro}
            rows={5}
            value={doc.exclusions}
            onChange={(e) => setField("exclusions", e.target.value)}
          />
        </Field>
        <Field label="Notes" wide>
          <Textarea
            disabled={ro}
            rows={3}
            value={doc.notes}
            onChange={(e) => setField("notes", e.target.value)}
          />
        </Field>
      </section>
    </div>
  );
}

function Field({
  label: text,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${wide ? "sm:col-span-2" : ""}`}>
      {text}
      {children}
    </label>
  );
}

function IconButton({
  label: text,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={text} title={text} {...props}>
      {children}
    </Button>
  );
}

function DeleteConfirm({
  what,
  count,
  onConfirm,
}: {
  what: string;
  count: number;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${what}`}
            title={`Delete ${what}`}
          />
        }
      >
        <Trash2 className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {what}?</DialogTitle>
          <DialogDescription>
            {count > 0 ? `This removes ${count} item${count === 1 ? "" : "s"} too. ` : ""}
            The change applies when you save.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  versions,
  disabled,
  onRestore,
}: {
  versions: Version[];
  disabled: boolean;
  onRestore: (s: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <History className="size-4" aria-hidden /> History
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            Snapshots are created when you publish or save a version.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {versions.length === 0 && (
            <li className="text-muted-foreground text-sm">No versions yet.</li>
          )}
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
            >
              <span>
                v{v.version_number}
                {v.label ? ` · ${v.label}` : ""}
                <span className="text-muted-foreground block text-xs">
                  <LocalTime value={v.created_at} />
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  onRestore(v.snapshot);
                  setOpen(false);
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
