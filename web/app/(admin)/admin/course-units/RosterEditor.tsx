"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, UserMinus, UserPlus } from "lucide-react";
import {
  enrollStudent,
  getCourseUnitRoster,
  searchStudents,
  unenrollStudent,
  type RosterEntry,
  type StudentSearchResult,
} from "@/lib/course-units-api";

export function RosterEditor({ courseUnitId }: { courseUnitId: string }) {
  const { t } = useTranslation();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRoster(await getCourseUnitRoster(courseUnitId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load roster"));
    } finally {
      setLoading(false);
    }
  }, [courseUnitId, t]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchStudents(trimmed)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const enrolledIds = new Set(roster.map((r) => r.user_id));

  async function handleEnroll(student: StudentSearchResult) {
    setBusyUserId(student.id);
    setError("");
    try {
      await enrollStudent(courseUnitId, student.id);
      await loadRoster();
      setQuery("");
      setResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to enroll student"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleUnenroll(entry: RosterEntry) {
    setBusyUserId(entry.user_id);
    setError("");
    try {
      await unenrollStudent(courseUnitId, entry.user_id);
      setRoster((prev) => prev.filter((r) => r.user_id !== entry.user_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to unenroll student"));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--background)]/40 p-4">
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="mb-3">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          {t("Enroll a student")}
        </p>
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search by name, username, or registration number…")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2 pl-9 pr-3 text-sm
                       text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/70
                       outline-none focus:border-[var(--ring)] transition-colors"
          />
        </div>
        {query.trim() && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-[var(--border)]">
            {searching ? (
              <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                {t("Searching…")}
              </p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                {t("No matching students")}
              </p>
            ) : (
              results.map((student) => {
                const already = enrolledIds.has(student.id);
                return (
                  <div
                    key={student.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-[var(--card)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[var(--foreground)]">
                        {student.full_name || student.username}
                      </p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        {student.username}
                        {student.registration_number
                          ? ` · ${student.registration_number}`
                          : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleEnroll(student)}
                      disabled={already || busyUserId === student.id}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 border border-[var(--border)] text-[var(--foreground)]
                                 hover:bg-[var(--background)] disabled:opacity-40 transition-colors"
                    >
                      <UserPlus size={12} />
                      {already ? t("Enrolled") : t("Enroll")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          {t("Roster")} {!loading && `(${roster.length})`}
        </p>
        {loading ? (
          <p className="text-xs text-[var(--muted-foreground)]">{t("Loading…")}</p>
        ) : roster.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("No students enrolled yet.")}
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {roster.map((entry) => (
              <div
                key={entry.user_id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-[var(--foreground)]">
                    {entry.full_name || entry.username}
                  </p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {entry.username}
                    {entry.registration_number ? ` · ${entry.registration_number}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => void handleUnenroll(entry)}
                  disabled={busyUserId === entry.user_id}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs
                             text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-500
                             disabled:opacity-40 transition-colors"
                >
                  <UserMinus size={12} />
                  {t("Remove")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
