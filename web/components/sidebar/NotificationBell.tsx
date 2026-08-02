"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  listNotifications,
  markNotificationRead,
  type Notification,
} from "@/lib/notifications-api";

// Lightweight, polling-based activity feed — no websocket push. Matches the
// deliberate scoping decision behind the backend feed (see
// deeptutor/multi_user/notifications.py).
const POLL_INTERVAL_MS = 30_000;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

/** Bell icon + unread badge, with a dropdown panel of recent activity.
 * Self-contained: fetches its own data and polls on an interval, so mounting
 * it anywhere just needs `<NotificationBell />`. Works for the collapsed
 * (icon-only) and expanded sidebar alike since it renders its own panel. */
export function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    listNotifications()
      .then(setNotifications)
      .catch(() => {
        // Best-effort — a failed poll just leaves the last-known list showing.
      });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleItemClick = (notification: Notification) => {
    if (notification.is_read) return;
    // Optimistic: flip locally immediately, reconcile silently in the background.
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)),
    );
    markNotificationRead(notification.id).catch(() => {
      // Best-effort — worst case it shows unread again on the next poll.
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("Notifications")}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
      >
        <Bell size={16} strokeWidth={1.5} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--destructive,#e5484d)] px-[3px] text-[9px] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[300px] max-h-[360px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--secondary)] shadow-lg">
          <div className="border-b border-[var(--border)] px-3 py-2 text-[12.5px] font-medium text-[var(--foreground)]">
            {t("Notifications")}
          </div>
          {notifications.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12.5px] text-[var(--muted-foreground)]">
              {t("No notifications yet")}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    onClick={() => handleItemClick(notification)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--background)]/60 ${
                      notification.is_read
                        ? "text-[var(--muted-foreground)]"
                        : "font-medium text-[var(--foreground)]"
                    }`}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      {!notification.is_read && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary,#4b8bf4)]" />
                      )}
                      <span className="line-clamp-2">{notification.title}</span>
                    </span>
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {relativeTime(notification.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
