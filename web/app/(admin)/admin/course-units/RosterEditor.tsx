"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Search, UserMinus, UserPlus, X as XIcon } from "lucide-react";
import {
  approveEnrollmentRequest,
  approveLeaveRequest,
  enrollStudent,
  getCourseUnitRequests,
  getCourseUnitRosterPaged,
  getLeaveRequests,
  rejectEnrollmentRequest,
  rejectLeaveRequest,
  searchStudents,
  unenrollStudent,
  type RosterEntry,
  type StudentSearchResult,
} from "@/lib/course-units-api";
import Pagination from "@/components/common/Pagination";

const ROSTER_PAGE_LIMIT = 50;

export function RosterEditor({ courseUnitId }: { courseUnitId: string }) {
  const { t } = useTranslation();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [rosterOffset, setRosterOffset] = useState(0);
  const [requests, setRequests] = useState<RosterEntry[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadAll = useCallback(async (offset: number = 0) => {
    setLoading(true);
    setError("");
    try {
      const [rosterPaged, requestList, leaveList] = await Promise.all([
        getCourseUnitRosterPaged(courseUnitId, ROSTER_PAGE_LIMIT, offset),
        getCourseUnitRequests(courseUnitId),
        getLeaveRequests(courseUnitId),
      ]);
      setRoster(rosterPaged.items);
      setRosterTotal(rosterPaged.total);
      setRequests(requestList);
      setLeaveRequests(leaveList);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load roster"));
    } finally {
      setLoading(false);
    }
  }, [courseUnitId, t]);

  useEffect(() => {
    void loadAll(rosterOffset);
  }, [loadAll, rosterOffset]);

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
  const pendingIds = new Set(requests.map((r) => r.user_id));

  async function handleEnroll(student: StudentSearchResult) {
    setBusyUserId(student.id);
    setError("");
    try {
      await enrollStudent(courseUnitId, student.id);
      await loadAll();
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

  async function handleApprove(entry: RosterEntry) {
    setBusyUserId(entry.user_id);
    setError("");
    try {
      await approveEnrollmentRequest(courseUnitId, entry.user_id);
      setRequests((prev) => prev.filter((r) => r.user_id !== entry.user_id));
      setRoster((prev) => [...prev, entry]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to approve request"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleReject(entry: RosterEntry) {
    setBusyUserId(entry.user_id);
    setError("");
    try {
      await rejectEnrollmentRequest(courseUnitId, entry.user_id);
      setRequests((prev) => prev.filter((r) => r.user_id !== entry.user_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to reject request"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleApproveLeave(entry: RosterEntry) {
    setBusyUserId(entry.user_id);
    setError("");
    try {
      await approveLeaveRequest(courseUnitId, entry.user_id);
      setLeaveRequests((prev) => prev.filter((r) => r.user_id !== entry.user_id));
      setRoster((prev) => prev.filter((r) => r.user_id !== entry.user_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to approve leave request"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRejectLeave(entry: RosterEntry) {
    setBusyUserId(entry.user_id);
    setError("");
    try {
      await rejectLeaveRequest(courseUnitId, entry.user_id);
      setLeaveRequests((prev) => prev.filter((r) => r.user_id !== entry.user_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to reject leave request"));
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
                const pending = pendingIds.has(student.id);
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
                      title={
                        pending
                          ? t("Already requested — approves it")
                          : undefined
                      }
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 border border-[var(--border)] text-[var(--foreground)]
                                 hover:bg-[var(--background)] disabled:opacity-40 transition-colors"
                    >
                      <UserPlus size={12} />
                      {already ? t("Enrolled") : pending ? t("Approve") : t("Enroll")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {(loading || requests.length > 0) && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("Pending requests")} {!loading && `(${requests.length})`}
          </p>
          {loading ? (
            <p className="text-xs text-[var(--muted-foreground)]">{t("Loading…")}</p>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-lg border border-amber-500/30 bg-amber-500/5">
              {requests.map((entry) => (
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => void handleApprove(entry)}
                      disabled={busyUserId === entry.user_id}
                      title={t("Approve")}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 border border-[var(--border)] text-[var(--foreground)]
                                 hover:bg-[var(--background)] disabled:opacity-40 transition-colors"
                    >
                      <Check size={12} />
                      {t("Approve")}
                    </button>
                    <button
                      onClick={() => void handleReject(entry)}
                      disabled={busyUserId === entry.user_id}
                      title={t("Reject")}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-500
                                 disabled:opacity-40 transition-colors"
                    >
                      <XIcon size={12} />
                      {t("Reject")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(loading || leaveRequests.length > 0) && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("Pending leave requests")} {!loading && `(${leaveRequests.length})`}
          </p>
          {loading ? (
            <p className="text-xs text-[var(--muted-foreground)]">{t("Loading…")}</p>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-lg border border-orange-500/30 bg-orange-500/5">
              {leaveRequests.map((entry) => (
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => void handleApproveLeave(entry)}
                      disabled={busyUserId === entry.user_id}
                      title={t("Confirm leave (removes student from roster)")}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 border border-[var(--border)] text-[var(--foreground)]
                                 hover:bg-[var(--background)] disabled:opacity-40 transition-colors"
                    >
                      <Check size={12} />
                      {t("Confirm leave")}
                    </button>
                    <button
                      onClick={() => void handleRejectLeave(entry)}
                      disabled={busyUserId === entry.user_id}
                      title={t("Keep enrolled")}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-500
                                 disabled:opacity-40 transition-colors"
                    >
                      <XIcon size={12} />
                      {t("Keep enrolled")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        {rosterTotal > ROSTER_PAGE_LIMIT && (
          <div className="mt-2">
            <Pagination
              total={rosterTotal}
              limit={ROSTER_PAGE_LIMIT}
              offset={rosterOffset}
              disabled={loading}
              onPageChange={(newOffset) => setRosterOffset(newOffset)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
