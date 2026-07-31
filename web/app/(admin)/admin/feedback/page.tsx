"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import { listMessageFeedback, type FeedbackEntry } from "@/lib/session-api";
import { ArrowLeft, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { formatDate as formatLocaleDate, type Language } from "@/lib/datetime";

function formatDate(epochSeconds: number, lang: Language): string {
  if (!epochSeconds) return "—";
  try {
    return formatLocaleDate(new Date(epochSeconds * 1000), lang);
  } catch {
    return "—";
  }
}

export default function FeedbackReviewPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEntries(await listMessageFeedback());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load feedback"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin") {
        router.replace("/");
        return;
      }
      void load();
    });
  }, [router, load]);

  const upCount = entries.filter((e) => e.rating === "up").length;
  const downCount = entries.filter((e) => e.rating === "down").length;
  const byCapability = entries.reduce<Record<string, { up: number; down: number }>>(
    (acc, e) => {
      const key = e.capability || "chat";
      acc[key] = acc[key] ?? { up: 0, down: 0 };
      if (e.rating === "up") acc[key].up += 1;
      if (e.rating === "down") acc[key].down += 1;
      return acc;
    },
    {},
  );

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <Link
            href="/admin/users"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back")}
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Response Feedback")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t(
                  "Thumbs up/down from your own chats — useful for comparing models and RAG setups.",
                )}
              </p>
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                         border border-[var(--border)] text-[var(--muted-foreground)]
                         hover:text-[var(--foreground)] hover:bg-[var(--card)]
                         disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {t("Refresh")}
            </button>
          </div>
        </div>

        {!loading && !error && entries.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <ThumbsUp size={13} /> {upCount}
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400">
              <ThumbsDown size={13} /> {downCount}
            </span>
            {Object.entries(byCapability).map(([capability, counts]) => (
              <span
                key={capability}
                className="rounded-full bg-[var(--muted)]/50 px-3 py-1 text-xs text-[var(--muted-foreground)]"
              >
                {capability}: {counts.up}↑ / {counts.down}↓
              </span>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
              {t("Loading…")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {t("No feedback yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("Rate a response with the thumbs up/down buttons in chat to see it here.")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {entries.map((entry) => (
                <div key={entry.message_id} className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    {entry.rating === "up" ? (
                      <ThumbsUp size={14} className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <ThumbsDown size={14} className="text-red-600 dark:text-red-400" />
                    )}
                    <span className="text-xs font-medium text-[var(--muted-foreground)]">
                      {entry.session_title || t("Untitled chat")}
                    </span>
                    {entry.capability && (
                      <span className="rounded-full bg-[var(--muted)]/50 px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                        {entry.capability}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                      {formatDate(entry.updated_at || entry.created_at, lang)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-[var(--foreground)]">
                    {entry.content}
                  </p>
                  {entry.comment && (
                    <p className="mt-1.5 text-xs italic text-[var(--muted-foreground)]">
                      “{entry.comment}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
