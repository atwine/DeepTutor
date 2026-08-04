"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getCourseCatalog,
  requestLeave,
  type CatalogCourseUnit,
} from "@/lib/course-units-api";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  ClipboardList,
  Clock,
  GraduationCap,
  LogOut,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

/**
 * Issue #54: Student-facing "My Course Units" page.
 *
 * Shows only the course units the student has a relationship with
 * (pending, approved, or leave_requested), pulled from the catalog
 * endpoint and filtered. This is distinct from the full catalog
 * (/courses) which shows all available courses.
 */
export default function MyCourseUnitsPage() {
  const router = useRouter();
  const { t } = useTranslation();

  const [units, setUnits] = useState<CatalogCourseUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const all = await getCourseCatalog();
      // Filter to only courses the student has a relationship with.
      // "teaching" is included for instructors browsing, but this page
      // is primarily for students — the filter keeps pending, approved,
      // and leave_requested statuses.
      const mine = all.filter(
        (u) =>
          u.my_status === "approved" ||
          u.my_status === "pending" ||
          u.my_status === "leave_requested",
      );
      setUnits(mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load course units"));
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
      void load();
    });
  }, [router, load]);

  async function handleLeave(unit: CatalogCourseUnit) {
    setBusyId(unit.id);
    setActionError("");
    try {
      await requestLeave(unit.id);
      setUnits((prev) =>
        prev.map((u) => (u.id === unit.id ? { ...u, my_status: "leave_requested" } : u)),
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : t("Failed to request leave"),
      );
    } finally {
      setBusyId(null);
    }
  }

  const enrolledUnits = units.filter((u) => u.my_status === "approved");
  const pendingUnits = units.filter((u) => u.my_status === "pending");
  const leaveRequestedUnits = units.filter((u) => u.my_status === "leave_requested");

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowLeft size={16} />
              {t("Back")}
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/courses"
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                {t("Browse Courses")} →
              </Link>
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("My Course Units")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Courses you've joined or applied to")}
              </p>
            </div>
          </div>
        </div>

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}

        {loading ? (
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
              >
                <div className="h-4 w-48 rounded bg-[var(--muted)]/60" />
                <div className="mt-2 h-3 w-full rounded bg-[var(--muted)]/40" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-red-500 shadow-sm">
            {error}
          </div>
        ) : units.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center shadow-sm">
            <BookOpen size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {t("No course units yet")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Browse the catalog to join a course.")}
            </p>
            <Link
              href="/courses"
              className="mt-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                         border border-[var(--border)] text-[var(--foreground)]
                         hover:bg-[var(--background)]/60 transition-colors"
            >
              <Plus size={14} />
              {t("Browse Courses")}
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Enrolled section */}
            {enrolledUnits.length > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  <Check size={14} strokeWidth={2} className="text-emerald-500" />
                  {t("Enrolled")} ({enrolledUnits.length})
                </h2>
                <div className="space-y-3">
                  {enrolledUnits.map((unit) => (
                    <div
                      key={unit.id}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-medium text-[var(--foreground)]">
                            {unit.name}
                          </h3>
                          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                            {unit.term || t("No term set")}
                            {unit.instructor_usernames.length > 0
                              ? ` · ${unit.instructor_usernames.join(", ")}`
                              : ""}
                          </p>
                          {(unit.start_date || unit.end_date) && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                              <Calendar size={11} strokeWidth={1.5} />
                              {unit.start_date || "—"} → {unit.end_date || "—"}
                            </p>
                          )}
                          {unit.description && (
                            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                              {unit.description}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <Check size={12} strokeWidth={2} />
                            {t("Enrolled")}
                          </span>
                          {unit.completed_at && (
                            <span
                              className="flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
                              title={new Date(unit.completed_at).toLocaleString()}
                            >
                              <Check size={12} strokeWidth={2} />
                              {t("Completed")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
                        <Link
                          href={`/courses/${unit.id}/assignments`}
                          className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <ClipboardList size={13} />
                          {t("Assignments")}
                        </Link>
                        <Link
                          href={`/courses/${unit.id}/notes`}
                          className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <BookOpen size={13} />
                          {t("Notes")}
                        </Link>
                        <Link
                          href={`/courses/${unit.id}/materials`}
                          className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <GraduationCap size={13} />
                          {t("Materials")}
                        </Link>
                        <button
                          onClick={() => void handleLeave(unit)}
                          disabled={busyId === unit.id}
                          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                     border border-[var(--border)] text-[var(--muted-foreground)]
                                     hover:text-red-500 hover:border-red-500/30
                                     disabled:opacity-50 transition-colors"
                        >
                          <LogOut size={11} />
                          {t("Request to leave")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending section */}
            {pendingUnits.length > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  <Clock size={14} strokeWidth={2} className="text-amber-500" />
                  {t("Pending Approval")} ({pendingUnits.length})
                </h2>
                <div className="space-y-3">
                  {pendingUnits.map((unit) => (
                    <div
                      key={unit.id}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-medium text-[var(--foreground)]">
                            {unit.name}
                          </h3>
                          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                            {unit.term || t("No term set")}
                            {unit.instructor_usernames.length > 0
                              ? ` · ${unit.instructor_usernames.join(", ")}`
                              : ""}
                          </p>
                          {unit.description && (
                            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                              {unit.description}
                            </p>
                          )}
                        </div>
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <Clock size={12} strokeWidth={2} />
                          {t("Requested")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leave requested section */}
            {leaveRequestedUnits.length > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  <LogOut size={14} strokeWidth={2} className="text-amber-500" />
                  {t("Leave Requested")} ({leaveRequestedUnits.length})
                </h2>
                <div className="space-y-3">
                  {leaveRequestedUnits.map((unit) => (
                    <div
                      key={unit.id}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-medium text-[var(--foreground)]">
                            {unit.name}
                          </h3>
                          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                            {unit.term || t("No term set")}
                            {unit.instructor_usernames.length > 0
                              ? ` · ${unit.instructor_usernames.join(", ")}`
                              : ""}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <Clock size={12} strokeWidth={2} />
                          {t("Leave requested")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
