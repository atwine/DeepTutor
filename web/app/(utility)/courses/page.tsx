"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getCourseCatalog,
  requestEnrollment,
  requestLeave,
  type CatalogCourseUnit,
} from "@/lib/course-units-api";
import { ArrowLeft, BookOpen, Calendar, Check, Clock, GraduationCap, LogOut, RefreshCw, Send } from "lucide-react";
import Link from "next/link";

export default function CourseCatalogPage() {
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
      setUnits(await getCourseCatalog());
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

  async function handleRequest(unit: CatalogCourseUnit) {
    setBusyId(unit.id);
    setActionError("");
    try {
      await requestEnrollment(unit.id);
      setUnits((prev) =>
        prev.map((u) => (u.id === unit.id ? { ...u, my_status: "pending" } : u)),
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : t("Failed to request enrollment"),
      );
    } finally {
      setBusyId(null);
    }
  }

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

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back")}
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Course Catalog")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Browse course units and request to join one")}
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
              {t("No course units available yet")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Check back once your instructors have set up their course units.")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {units.map((unit) => (
              <div
                key={unit.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-medium text-[var(--foreground)]">
                      {unit.name}
                    </h2>
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
                    {unit.my_status === "approved" ? (
                      <>
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <Check size={12} strokeWidth={2} />
                          {t("Enrolled")}
                        </span>
                        {/* Issue #4: automatic completion — shown when all
                         * published assignments are submitted+graded.
                         * Completion never revokes read access. */}
                        {unit.completed_at && (
                          <span
                            className="flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
                            title={new Date(unit.completed_at).toLocaleString()}
                          >
                            <Check size={12} strokeWidth={2} />
                            {t("Completed")}
                          </span>
                        )}
                        <Link
                          href={`/courses/${unit.id}/assignments`}
                          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          {t("Assignments")} →
                        </Link>
                        <Link
                          href={`/courses/${unit.id}/notes`}
                          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          {t("Notes")} →
                        </Link>
                        <button
                          onClick={() => void handleLeave(unit)}
                          disabled={busyId === unit.id}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                     border border-[var(--border)] text-[var(--muted-foreground)]
                                     hover:text-red-500 hover:border-red-500/30
                                     disabled:opacity-50 transition-colors"
                        >
                          <LogOut size={11} />
                          {t("Request to leave")}
                        </button>
                      </>
                    ) : unit.my_status === "leave_requested" ? (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Clock size={12} strokeWidth={2} />
                        {t("Leave requested")}
                      </span>
                    ) : unit.my_status === "pending" ? (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Clock size={12} strokeWidth={2} />
                        {t("Requested")}
                      </span>
                    ) : unit.my_status === "teaching" ? (
                      <span className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
                        <GraduationCap size={12} strokeWidth={2} />
                        {t("You teach this")}
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleRequest(unit)}
                        disabled={busyId === unit.id}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                                   border border-[var(--border)] text-[var(--foreground)]
                                   hover:bg-[var(--background)]/60 disabled:opacity-50 transition-colors"
                      >
                        <Send size={13} />
                        {t("Request to join")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
