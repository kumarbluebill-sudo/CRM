"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteImageAction,
  linkImageAction,
  unlinkImageAction,
} from "@/app/(app)/itineraries/[id]/package/actions";
import type { ImageLink, PackageImage } from "@/lib/packages/queries";

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";
const MAX = 5 * 1024 * 1024;
const ROLE_LABEL = { COVER: "Cover", GALLERY: "Gallery", HOTEL: "Hotel", DAY: "Day" } as const;

function Photo({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div
        className={`bg-muted text-muted-foreground flex items-center justify-center ${className ?? ""}`}
        role="img"
        aria-label={`${alt} (not available)`}
      >
        <ImageOff className="size-5" aria-hidden />
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/package-images/${id}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function ImageManager({
  itineraryId,
  days,
  links,
  library,
  canEdit,
  canDelete,
}: {
  itineraryId: string;
  days: number;
  links: ImageLink[];
  library: PackageImage[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [role, setRole] = useState("GALLERY");
  const [day, setDay] = useState("1");
  const [pickRole, setPickRole] = useState<Record<string, string>>({});

  const refresh = () => router.refresh();
  const report = (r: { ok?: boolean; message?: string }) => {
    if (r.message) (r.ok ? toast.success : toast.error)(r.message);
    refresh();
  };

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const picked = file.current?.files?.[0];
    if (!picked) return void toast.error("Choose a photo.");
    if (picked.size > MAX) return void toast.error("The photo must be 5 MB or smaller.");
    if (form.get("rights") !== "on")
      return void toast.error("Confirm that you have the right to use this photo.");
    const body = new FormData();
    body.set("file", picked);
    for (const k of ["aspect", "focus", "alt", "rights", "role"])
      body.set(k, String(form.get(k) ?? ""));
    if (form.get("role")) {
      body.set("itineraryId", itineraryId);
      if (form.get("role") === "DAY") body.set("dayNumber", String(form.get("dayNumber") ?? ""));
    }
    setBusy(true);
    try {
      const res = await fetch("/api/package-images", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!res.ok) return void toast.error(json.error ?? "Upload failed.");
      toast[json.warning ? "warning" : "success"](json.warning ?? "Photo uploaded.");
      if (file.current) file.current.value = "";
      refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const byRole = (r: ImageLink["role"]) => links.filter((l) => l.role === r);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photos in this package</CardTitle>
          <p className="text-muted-foreground text-xs">
            Use only photographs you took or have the right to use. Nothing is fetched from other
            websites.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {links.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <ImageOff className="size-4" aria-hidden /> No photos yet. The document will show a
              neutral placeholder.
            </p>
          ) : (
            (["COVER", "GALLERY", "HOTEL", "DAY"] as const).map((r) => {
              const rows = byRole(r);
              if (rows.length === 0) return null;
              return (
                <section key={r} aria-label={`${ROLE_LABEL[r]} photos`}>
                  <h3 className="pb-1.5 text-xs font-semibold uppercase">{ROLE_LABEL[r]}</h3>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {rows.map((l) => (
                      <li key={l.id} className="relative overflow-hidden rounded-lg border">
                        <Photo
                          id={l.image_id}
                          alt={l.package_images?.alt || l.package_images?.name || "Package photo"}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <div className="flex items-center justify-between gap-1 p-1.5 text-xs">
                          <span className="truncate">
                            {r === "DAY" ? `Day ${l.day_number}` : l.package_images?.name}
                          </span>
                          {canEdit && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Remove from package"
                              disabled={pending}
                              onClick={() =>
                                start(async () =>
                                  report(await unlinkImageAction(itineraryId, l.id)),
                                )
                              }
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload a photo</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="pi-file" className="text-sm font-medium">
                  Photo (JPEG, PNG or WebP, up to 5 MB)
                </label>
                <input
                  ref={file}
                  id="pi-file"
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp"
                  className="text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pi-aspect" className="text-sm font-medium">
                  Crop to
                </label>
                <select id="pi-aspect" name="aspect" defaultValue="16:9" className={selectClass}>
                  <option value="ORIGINAL">Keep original shape</option>
                  <option value="16:9">Wide (16:9)</option>
                  <option value="4:3">Standard (4:3)</option>
                  <option value="1:1">Square</option>
                  <option value="3:4">Portrait (3:4)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pi-focus" className="text-sm font-medium">
                  Keep this part
                </label>
                <select id="pi-focus" name="focus" defaultValue="CENTER" className={selectClass}>
                  <option value="CENTER">Centre</option>
                  <option value="TOP">Top</option>
                  <option value="BOTTOM">Bottom</option>
                  <option value="LEFT">Left</option>
                  <option value="RIGHT">Right</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pi-role" className="text-sm font-medium">
                  Use it as
                </label>
                <select
                  id="pi-role"
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Library only (place it later)</option>
                  <option value="COVER">Cover photo</option>
                  <option value="GALLERY">Destination gallery</option>
                  <option value="HOTEL">Hotel photo</option>
                  <option value="DAY">Itinerary day photo</option>
                </select>
              </div>
              {role === "DAY" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="pi-day" className="text-sm font-medium">
                    Day
                  </label>
                  <select
                    id="pi-day"
                    name="dayNumber"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    className={selectClass}
                  >
                    {Array.from({ length: Math.max(days, 1) }, (_, i) => (
                      <option key={i} value={i + 1}>
                        Day {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="pi-alt" className="text-sm font-medium">
                  Short description (for accessibility)
                </label>
                <Input
                  id="pi-alt"
                  name="alt"
                  maxLength={200}
                  placeholder="Sunset over the beach at Varkala"
                />
              </div>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  name="rights"
                  className="mt-0.5 size-4 rounded border"
                  required
                />
                <span>
                  I took this photo, or I have the right to use it in documents sent to customers.
                </span>
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Upload photo
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photo library</CardTitle>
        </CardHeader>
        <CardContent>
          {library.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Your library is empty. Uploaded photos can be reused in any package.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {library.map((img) => (
                <li key={img.id} className="flex flex-col overflow-hidden rounded-lg border">
                  <Photo
                    id={img.id}
                    alt={img.alt || img.name}
                    className="aspect-[4/3] w-full object-cover"
                  />
                  <div className="flex flex-col gap-1.5 p-1.5">
                    <span className="truncate text-xs">{img.name}</span>
                    {canEdit && (
                      <div className="flex gap-1">
                        <select
                          aria-label={`Place ${img.name} as`}
                          className={selectClass}
                          value={pickRole[img.id] ?? "GALLERY"}
                          onChange={(e) => setPickRole((p) => ({ ...p, [img.id]: e.target.value }))}
                        >
                          <option value="COVER">Cover</option>
                          <option value="GALLERY">Gallery</option>
                          <option value="HOTEL">Hotel</option>
                          {Array.from({ length: Math.max(days, 1) }, (_, i) => (
                            <option key={i} value={`DAY:${i + 1}`}>
                              Day {i + 1}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const v = pickRole[img.id] ?? "GALLERY";
                              const [r, d] = v.split(":");
                              report(
                                await linkImageAction(
                                  itineraryId,
                                  img.id,
                                  r === "DAY" ? "DAY" : r,
                                  d ? Number(d) : undefined,
                                ),
                              );
                            })
                          }
                        >
                          Add
                        </Button>
                        {canDelete && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete ${img.name} from the library`}
                            disabled={pending}
                            onClick={() => {
                              if (
                                confirm(
                                  "Delete this photo from the library? It is removed from every package using it.",
                                )
                              ) {
                                start(async () =>
                                  report(await deleteImageAction(itineraryId, img.id)),
                                );
                              }
                            }}
                          >
                            <Trash2 className="text-destructive size-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
