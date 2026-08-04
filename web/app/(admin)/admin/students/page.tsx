"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getStudentsOverview,
  type StudentOverviewRow,
  type StudentOverviewStats,
} from "@/lib/admin-api";
import { UserAvatar } from "@/components/UserAvatar";
import { formatDate as formatLocaleDate, type Language } from "@/lib/datetime";
import {
  Search,
  RefreshCw,
  ArrowLeft,
  Users,
  GraduationCap,
  ClipboardCheck,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
} from "lucide-react";
import Link from "next/link";

function formatDate(iso: string, lang: Language): string {
  if (!iso) return "—";
  try {
    return formatLocaleDate(new Date(iso), lang);
  } catch {
    return "—";
  }
}

type StatusFilter = "all" | "active" | "disabled";
type CompletionFilter = "all" | "completed" | "incomplete";
type SortKey = "name" | "enrollments" | "submissions" | "created";

export default function AdminStudentsPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StudentOverviewStats | null>(null);
  const [courseOptions, setCourseOptions] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentOverviewRow[]>([]);

  // Filters
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [completionFilter, setCompletionFilter] =
    useState<CompletionFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getStudentsOverview();
      setStats(data.stats);
      setCourseOptions(data.course_options);
      setStudents(data.students);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load students"));
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

  // Apply filters + search + sort
  const filteredStudents = useMemo(() => {
    let result = students;

    // Text search: username, first name, surname, registration number
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      result = result.filter((s) => {
        const haystack = [
          s.username,
          s.first_name,
          s.surname,
          s.registration_number,
          s.full_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      });
    }

    // Course filter
    if (courseFilter !== "all") {
      result = result.filter((s) => s.course_names.includes(courseFilter));
    }

    // Status filter
    if (statusFilter === "active") {
      result = result.filter((s) => !s.disabled);
    } else if (statusFilter === "disabled") {
      result = result.filter((s) => s.disabled);
    }

    // Completion filter
    if (completionFilter === "completed") {
      result = result.filter(
        (s) =>
          s.completion_summary.total > 0 &&
          s.completion_summary.completed === s.completion_summary.total,
      );
    } else if (completionFilter === "incomplete") {
      result = result.filter(
        (s) =>
          s.completion_summary.total === 0 ||
          s.completion_summary.completed < s.completion_summary.total,
      );
    }

    // Sort
    const sorted = [...result];
    switch (sortBy) {
      case "enrollments":
        sorted.sort((a, b) => b.enrollment_count - a.enrollment_count);
        break;
      case "submissions":
        sorted.sort((a, b) => b.submission_count - a.submission_count);
        break;
      case "created":
        sorted.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        );
        break;
      default:
        sorted.sort((a, b) => a.username.localeCompare(b.username));
    }

    return sorted;
  }, [students, query, courseFilter, statusFilter, completionFilter, sortBy]);

  const hasActiveFilters =
    query.trim() ||
    courseFilter !== "all" ||
    statusFilter !== "all" ||
    completionFilter !== "all";

  function clearFilters() {
    setQuery("");
    setCourseFilter("all");
    setStatusFilter("all");
    setCompletionFilter("all");
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
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
                href="/admin/users"
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                {t("Accounts Management")} →
              </Link>
              <Link
                href="/admin/course-units"
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                {t("Course Units")} →
              </Link>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Student Dashboard")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Overview of all students, their enrollments, and completion status")}
              </p>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                         border border-[var(--border)] text-[var(--muted-foreground)]
                         hover:text-[var(--foreground)] hover:bg-[var(--card)]
                         disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                size={14}
                className={loading ? "animate-spin" : ""}
              />
              {t("Refresh")}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Stats cards */}
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              icon={<Users size={18} />}
              label={t("Total Students")}
              value={stats.total_students}
              sublabel={`${stats.active_students} active · ${stats.disabled_students} disabled`}
            />
            <StatCard
              icon={<GraduationCap size={18} />}
              label={t("Courses")}
              value={stats.total_courses}
              sublabel={`${stats.total_instructors} ${t("instructors")}`}
            />
            <StatCard
              icon={<ClipboardCheck size={18} />}
              label={t("Enrollments")}
              value={stats.total_enrollments}
              sublabel={`${stats.orphan_students} ${t("not enrolled")}`}
            />
            <StatCard
              icon={<TrendingUp size={18} />}
              label={t("Completion Rate")}
              value={`${stats.completion_rate}%`}
              sublabel={t("across all enrollments")}
            />
          </div>
        )}

        {/* Search + filters */}
        {!loading && !error && students.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search students…")}
                aria-label={t("Search students")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2 pl-9 pr-3 text-sm
                           text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/70
                           outline-none focus:border-[var(--ring)] transition-colors"
              />
            </div>

            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm
                         text-[var(--foreground)] outline-none focus:border-[var(--ring)] transition-colors"
            >
              <option value="all">{t("All courses")}</option>
              {courseOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm
                         text-[var(--foreground)] outline-none focus:border-[var(--ring)] transition-colors"
            >
              <option value="all">{t("All status")}</option>
              <option value="active">{t("Active")}</option>
              <option value="disabled">{t("Disabled")}</option>
            </select>

            <select
              value={completionFilter}
              onChange={(e) =>
                setCompletionFilter(e.target.value as CompletionFilter)
              }
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm
                         text-[var(--foreground)] outline-none focus:border-[var(--ring)] transition-colors"
            >
              <option value="all">{t("All completion")}</option>
              <option value="completed">{t("Completed")}</option>
              <option value="incomplete">{t("Incomplete")}</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm
                         text-[var(--foreground)] outline-none focus:border-[var(--ring)] transition-colors"
            >
              <option value="name">{t("Sort: Name")}</option>
              <option value="enrollments">{t("Sort: Enrollments")}</option>
              <option value="submissions">{t("Sort: Submissions")}</option>
              <option value="created">{t("Sort: Joined")}</option>
            </select>

            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
              {t("{{count}} students", { count: filteredStudents.length })}
            </span>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                           text-[var(--muted-foreground)] hover:text-[var(--foreground)]
                           hover:bg-[var(--card)] transition-colors"
              >
                <X size={12} />
                {t("Clear")}
              </button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="divide-y divide-[var(--border)]" aria-hidden>
              {[0, 1, 2, 3, 4].map((row) => (
                <div
                  key={row}
                  className="flex animate-pulse items-center gap-3 px-5 py-4"
                >
                  <div className="h-8 w-8 rounded-full bg-[var(--muted)]/60" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-36 rounded bg-[var(--muted)]/60" />
                    <div className="h-2.5 w-24 rounded bg-[var(--muted)]/40" />
                  </div>
                  <div className="h-5 w-16 rounded-full bg-[var(--muted)]/40" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : students.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Users
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No students yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("Students will appear here once they register.")}
              </p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Search
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No students match your filters")}
              </p>
              <button
                onClick={clearFilters}
                className="mt-4 rounded-lg px-3 py-1.5 text-sm border border-[var(--border)]
                           text-[var(--muted-foreground)] hover:text-[var(--foreground)]
                           hover:bg-[var(--background)]/60 transition-colors"
              >
                {t("Clear filters")}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                    <th className="px-5 py-3 font-medium">{t("Student")}</th>
                    <th className="px-5 py-3 font-medium">{t("Reg. #")}</th>
                    <th className="px-5 py-3 font-medium">{t("Program")}</th>
                    <th className="px-5 py-3 font-medium">{t("Courses")}</th>
                    <th className="px-5 py-3 font-medium">{t("Submissions")}</th>
                    <th className="px-5 py-3 font-medium">{t("Completion")}</th>
                    <th className="px-5 py-3 font-medium">{t("Joined")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredStudents.map((student) => {
                    const isComplete =
                      student.completion_summary.total > 0 &&
                      student.completion_summary.completed ===
                        student.completion_summary.total;
                    return (
                      <tr
                        key={student.id}
                        className="group hover:bg-[var(--background)]/50 transition-colors"
                      >
                        {/* Student (avatar + name) */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              username={student.username}
                              userId={student.id}
                              avatar={student.avatar}
                              role="user"
                              size={32}
                            />
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-[var(--foreground)]">
                                {student.username}
                              </span>
                              {(student.first_name || student.surname) && (
                                <span className="block truncate text-xs text-[var(--muted-foreground)]">
                                  {student.first_name} {student.surname}
                                </span>
                              )}
                              {student.disabled && (
                                <span className="mt-0.5 inline-block rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                  {t("Disabled")}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Registration # */}
                        <td className="px-5 py-3 text-[var(--muted-foreground)]">
                          {student.registration_number || "—"}
                        </td>

                        {/* Program (Masters/PhD) */}
                        <td className="px-5 py-3 text-[var(--muted-foreground)]">
                          {student.course
                            ? student.course.charAt(0).toUpperCase() +
                              student.course.slice(1)
                            : "—"}
                        </td>

                        {/* Courses (badges) */}
                        <td className="px-5 py-3">
                          {student.course_names.length === 0 ? (
                            <span className="text-[var(--muted-foreground)]/60">
                              {t("None")}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {student.course_names.map((name) => (
                                <span
                                  key={name}
                                  className="inline-block rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs
                                             text-[var(--foreground)]"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Submissions */}
                        <td className="px-5 py-3 text-[var(--foreground)]">
                          {student.submission_count}
                        </td>

                        {/* Completion */}
                        <td className="px-5 py-3">
                          {student.completion_summary.total === 0 ? (
                            <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]/60">
                              <AlertCircle size={12} />
                              {t("Not enrolled")}
                            </span>
                          ) : isComplete ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 size={12} />
                              {t("{{completed}}/{{total}} complete", {
                                completed: student.completion_summary.completed,
                                total: student.completion_summary.total,
                              })}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <Clock size={12} />
                              {t("{{completed}}/{{total}} complete", {
                                completed: student.completion_summary.completed,
                                total: student.completion_summary.total,
                              })}
                            </span>
                          )}
                        </td>

                        {/* Joined */}
                        <td className="px-5 py-3 text-xs text-[var(--muted-foreground)]">
                          {formatDate(student.created_at, lang)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card component
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
        {value}
      </div>
      {sublabel && (
        <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {sublabel}
        </div>
      )}
    </div>
  );
}
