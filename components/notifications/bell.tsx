"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/notifications/actions";
import type { NotificationItem } from "@/lib/notifications/queries";

const POLL_MS = 45_000;

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/**
 * Notification bell. It refreshes on a timer while the tab is visible (and when the tab becomes visible again), which
 * needs no extra infrastructure. Opening an item marks it read and goes to the record, which checks permissions itself.
 */
export function NotificationBell({
  initialUnread,
  initialItems,
}: {
  initialUnread: number;
  initialItems: NotificationItem[];
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState(initialItems);
  const [failed, setFailed] = useState(false);
  // follow the server when the page is re-rendered with newer data (for example after Mark all as read elsewhere)
  const [seen, setSeen] = useState({ initialUnread, initialItems });
  if (seen.initialUnread !== initialUnread || seen.initialItems !== initialItems) {
    setSeen({ initialUnread, initialItems });
    setUnread(initialUnread);
    setItems(initialItems);
  }
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const res = await fetch("/api/notifications/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { unread: number; items: NotificationItem[] };
      setUnread(data.unread);
      setItems(data.items);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const open = async (n: NotificationItem) => {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await markNotificationReadAction(n.id);
    }
    router.push(n.href);
  };

  const markAll = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markAllNotificationsReadAction();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative"
          />
        }
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <Button size="xs" variant="ghost" disabled={unread === 0} onClick={markAll}>
            <CheckCheck className="size-3.5" aria-hidden /> Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto" aria-label="Recent notifications">
          {items.length === 0 ? (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">
              {failed ? "Couldn't refresh. Will try again." : "You're all caught up."}
            </li>
          ) : (
            items.map((n) => (
              <li key={n.id}>
                <DropdownMenuItem
                  className="flex cursor-pointer flex-col items-start gap-0.5 rounded-none px-3 py-2"
                  onClick={() => void open(n)}
                >
                  <span className="flex w-full items-start gap-2">
                    {!n.read && (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-600"
                        aria-label="Unread"
                      />
                    )}
                    <span className={`text-sm ${n.read ? "" : "font-semibold"}`}>{n.title}</span>
                  </span>
                  {n.body && (
                    <span className="text-muted-foreground line-clamp-2 pl-4 text-xs">
                      {n.body}
                    </span>
                  )}
                  <span className="text-muted-foreground pl-4 text-[11px]">{ago(n.createdAt)}</span>
                </DropdownMenuItem>
              </li>
            ))
          )}
        </ul>
        <div className="border-t px-3 py-2 text-center">
          <Link href="/notifications" className="text-primary text-sm underline">
            See all and preferences
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
