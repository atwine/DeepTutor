import { apiFetch, apiUrl } from "@/lib/api";

/** Matches the dict shape `notifications.py`'s `_notification_to_dict` returns. */
export interface Notification {
  id: string;
  course_unit_id: string;
  kind: string;
  title: string;
  created_at: string;
  is_read: boolean;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? fallback);
  }
  return res.json() as Promise<T>;
}

/** Current user's activity feed — every notification for every course unit
 * they're approved-enrolled in, newest first. An instructor/admin with no
 * enrollments of their own simply gets an empty list. */
export async function listNotifications(): Promise<Notification[]> {
  const res = await apiFetch(apiUrl("/api/v1/multi-user/notifications"));
  const data = await unwrap<{ notifications: Notification[] }>(
    res,
    "Failed to load notifications",
  );
  return data.notifications;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/notifications/${encodeURIComponent(notificationId)}/read`),
    { method: "POST" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to mark notification read");
}
