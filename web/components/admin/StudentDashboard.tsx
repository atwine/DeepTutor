"use client";

import { useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatDate as formatLocaleDate, type Language } from "@/lib/datetime";
import type {
  StudentOverviewRow,
  StudentOverviewStats,
} from "@/lib/admin-api";
import {
  deleteUser,
  setUserDisabled,
} from "@/lib/admin-api";
import {
  listCourseUnits,
  enrollStudent,
  unenrollStudent,
  type CourseUnit,
} from "@/lib/course-units-api";
import {
  Search,
  Users,
  GraduationCap,
  ClipboardCheck,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
  UserPlus,
  Ban,
  CircleCheck,
  Trash2,
  RefreshCw,
} from "lucide-react";

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

type ConfirmKind = "delete" | "disable" | "enable" | "unenroll" | "bulk_disable" | "bulk_delete" | "bulk_enroll";

interface StudentDashboardProps {
  stats: StudentOverviewStats | null;
  courseOptions: string[];
  students: StudentOverviewRow[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  /** Hide stats that don't make sense for the instructor view
   * (orphan students, total instructors). */
  hideIrrelevantStats?: boolean;
  /** Show admin action buttons (enroll, disable, delete, bulk). */
  enableActions?: boolean;
}

export function StudentDashboard({
  stats,
  courseOptions,
  students,
  loading,
  error,
  onRefresh,
  hideIrrelevantStats = false,
  enableActions = false,
}: StudentDashboardProps) {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [completionFilter, setCompletionFilter] =
    useState<CompletionFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");

  // Action state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allCourses, setAllCourses] = useState<CourseUnit[]>([]);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: ConfirmKind;
    student?: StudentOverviewRow;
    courseUnitId?: string;
    courseName?: string;
  } | null>(null);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [enrollTarget, setEnrollTarget] = useState<StudentOverviewRow | null>(null);
  const [enrollCourseId, setEnrollCourseId] = useState("");
  const [bulkEnrollCourseId, setBulkEnrollCourseId] = useState("");
  const [showBulkEnroll, setShowBulkEnroll] = useState(false);

  // Load all course units for the enroll dialog
  const loadCourses = useCallback(async () => {
    try {
      const units = await listCourseUnits();
      setAllCourses(units);
    } catch {
      // silently fail — the enroll dialog will show an empty list
    }
  }, []);

  const filteredStudents = useMemo(() => {
    let result = students;

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

    if (courseFilter !== "all") {
      result = result.filter((s) => s.course_names.includes(courseFilter));
    }

    if (statusFilter === "active") {
      result = result.filter((s) => !s.disabled);
    } else if (statusFilter === "disabled") {
      result = result.filter((s) => s.disabled);
    }

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

  // --- Bulk selection ---
  const allFilteredSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((s) => selectedIds.has(s.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map((s) => s.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setShowBulkEnroll(false);
  }

  // --- Actions ---
  async function handleConfirm() {
    if (!confirm || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      if (confirm.kind === "delete" && confirm.student) {
        await deleteUser(confirm.student.username);
        setConfirm(null);
        onRefresh();
      } else if (confirm.kind === "disable" && confirm.student) {
        await setUserDisabled(confirm.student.username, true);
        setConfirm(null);
        onRefresh();
      } else if (confirm.kind === "enable" && confirm.student) {
        await setUserDisabled(confirm.student.username, false);
        setConfirm(null);
        onRefresh();
      } else if (confirm.kind === "unenroll" && confirm.student && confirm.courseUnitId) {
        await unenrollStudent(confirm.courseUnitId, confirm.student.id);
        setConfirm(null);
        onRefresh();
      } else if (confirm.kind === "bulk_disable") {
        await Promise.all(
          Array.from(selectedIds).map((id) => {
            const s = students.find((r) => r.id === id);
            return s ? setUserDisabled(s.username, true) : Promise.resolve();
          }),
        );
        setConfirm(null);
        clearSelection();
        onRefresh();
      } else if (confirm.kind === "bulk_delete") {
        await Promise.all(
          Array.from(selectedIds).map((id) => {
            const s = students.find((r) => r.id === id);
            return s ? deleteUser(s.username) : Promise.resolve();
          }),
        );
        setConfirm(null);
        clearSelection();
        onRefresh();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Action failed"));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleEnroll() {
    if (!enrollTarget || !enrollCourseId || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await enrollStudent(enrollCourseId, enrollTarget.id);
      setEnrollDialogOpen(false);
      setEnrollTarget(null);
      setEnrollCourseId("");
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to enroll"));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleBulkEnroll() {
    if (!bulkEnrollCourseId || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => enrollStudent(bulkEnrollCourseId, id)),
      );
      setShowBulkEnroll(false);
      setBulkEnrollCourseId("");
      clearSelection();
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to enroll"));
    } finally {
      setActionBusy(false);
    }
  }

  function openEnrollDialog(student: StudentOverviewRow) {
    setEnrollTarget(student);
    setEnrollCourseId("");
    setEnrollDialogOpen(true);
    void loadCourses();
  }

  const selectedCount = selectedIds.size;

  return (
    <>
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {actionError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {actionError}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={<Users size={18} />}
            label={t("Total Students")}
            value={stats.total_students}
            sublabel={`${stats.active_students} ${t("active")} · ${stats.disabled_students} ${t("disabled")}`}
          />
          <StatCard
            icon={<GraduationCap size={18} />}
            label={t("Courses")}
            value={stats.total_courses}
            sublabel={hideIrrelevantStats ? undefined : `${stats.total_instructors} ${t("instructors")}`}
          />
          <StatCard
            icon={<ClipboardCheck size={18} />}
            label={t("Enrollments")}
            value={stats.total_enrollments}
            sublabel={hideIrrelevantStats ? undefined : `${stats.orphan_students} ${t("not enrolled")}`}
          />
          <StatCard
            icon={<TrendingUp size={18} />}
            label={t("Completion Rate")}
            value={`${stats.completion_rate}%`}
            sublabel={t("across all enrollments")}
          />
        </div>
      )}

      {/* Bulk action bar */}
      {enableActions && selectedCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5">
          <span className="text-sm font-medium text-[var(--foreground)]">
            {t("{{count}} selected", { count: selectedCount })}
          </span>
          <div className="h-4 w-px bg-[var(--border)]" />
          {!showBulkEnroll ? (
            <button
              onClick={() => { setShowBulkEnroll(true); void loadCourses(); }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm
                         text-[var(--foreground)] hover:bg-[var(--background)]/60 transition-colors"
            >
              <UserPlus size={14} />
              {t("Enroll in course")}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={bulkEnrollCourseId}
                onChange={(e) => setBulkEnrollCourseId(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm
                           text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              >
                <option value="">{t("Select course…")}</option>
                {allCourses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => setConfirm({ kind: "bulk_enroll" })}
                disabled={!bulkEnrollCourseId || actionBusy}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1 text-sm font-medium
                           text-[var(--background)] disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {t("Enroll")}
              </button>
              <button
                onClick={() => { setShowBulkEnroll(false); setBulkEnrollCourseId(""); }}
                className="rounded-lg px-2 py-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {t("Cancel")}
              </button>
            </div>
          )}
          <button
            onClick={() => setConfirm({ kind: "bulk_disable" })}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm
                       text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <Ban size={14} />
            {t("Disable")}
          </button>
          <button
            onClick={() => setConfirm({ kind: "bulk_delete" })}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm
                       text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
            {t("Delete")}
          </button>
          <button
            onClick={clearSelection}
            className="ml-auto rounded-lg px-2 py-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            {t("Clear selection")}
          </button>
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
              <option key={c} value={c}>{c}</option>
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
            onChange={(e) => setCompletionFilter(e.target.value as CompletionFilter)}
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
              <div key={row} className="flex animate-pulse items-center gap-3 px-5 py-4">
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
          <div className="flex items-center justify-center py-16 text-red-500 text-sm">{error}</div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Users size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">{t("No students yet")}</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Students will appear here once they enroll in your courses.")}
            </p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Search size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">{t("No students match your filters")}</p>
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
                  {enableActions && (
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-[var(--border)] accent-[var(--foreground)]"
                        aria-label={t("Select all")}
                      />
                    </th>
                  )}
                  <th className="px-5 py-3 font-medium">{t("Student")}</th>
                  <th className="px-5 py-3 font-medium">{t("Reg. #")}</th>
                  <th className="px-5 py-3 font-medium">{t("Program")}</th>
                  <th className="px-5 py-3 font-medium">{t("Courses")}</th>
                  <th className="px-5 py-3 font-medium">{t("Submissions")}</th>
                  <th className="px-5 py-3 font-medium">{t("Completion")}</th>
                  <th className="px-5 py-3 font-medium">{t("Joined")}</th>
                  {enableActions && (
                    <th className="px-5 py-3 font-medium text-right">{t("Actions")}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredStudents.map((student) => {
                  const isComplete =
                    student.completion_summary.total > 0 &&
                    student.completion_summary.completed === student.completion_summary.total;
                  const isSelected = selectedIds.has(student.id);
                  return (
                    <tr
                      key={student.id}
                      className={`group hover:bg-[var(--background)]/50 transition-colors ${isSelected ? "bg-[var(--muted)]/20" : ""}`}
                    >
                      {enableActions && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(student.id)}
                            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--foreground)]"
                            aria-label={t("Select {{name}}", { name: student.username })}
                          />
                        </td>
                      )}
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
                      <td className="px-5 py-3 text-[var(--muted-foreground)]">
                        {student.registration_number || "—"}
                      </td>
                      <td className="px-5 py-3 text-[var(--muted-foreground)]">
                        {student.course
                          ? student.course.charAt(0).toUpperCase() + student.course.slice(1)
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {student.course_names.length === 0 ? (
                          <span className="text-[var(--muted-foreground)]/60">{t("None")}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {student.course_names.map((name) => {
                              const courseUnit = allCourses.find((c) => c.name === name);
                              return (
                                <span
                                  key={name}
                                  className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs text-[var(--foreground)]"
                                >
                                  {name}
                                  {enableActions && courseUnit && (
                                    <button
                                      onClick={() =>
                                        setConfirm({
                                          kind: "unenroll",
                                          student,
                                          courseUnitId: courseUnit.id,
                                          courseName: name,
                                        })
                                      }
                                      className="ml-0.5 rounded-full p-0.5 text-[var(--muted-foreground)]
                                                 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                      aria-label={t("Unenroll from {{course}}", { course: name })}
                                      title={t("Unenroll")}
                                    >
                                      <X size={10} />
                                    </button>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[var(--foreground)]">
                        {student.submission_count}
                      </td>
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
                      <td className="px-5 py-3 text-xs text-[var(--muted-foreground)]">
                        {formatDate(student.created_at, lang)}
                      </td>
                      {enableActions && (
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEnrollDialog(student)}
                              className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                         hover:text-[var(--foreground)] hover:bg-[var(--background)]/60
                                         transition-colors"
                              title={t("Enroll in course")}
                              aria-label={t("Enroll in course")}
                            >
                              <UserPlus size={14} />
                            </button>
                            {student.disabled ? (
                              <button
                                onClick={() => setConfirm({ kind: "enable", student })}
                                className="rounded-lg p-1.5 text-emerald-600 dark:text-emerald-400
                                           hover:bg-emerald-500/10 transition-colors"
                                title={t("Enable")}
                                aria-label={t("Enable")}
                              >
                                <CircleCheck size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => setConfirm({ kind: "disable", student })}
                                className="rounded-lg p-1.5 text-amber-600 dark:text-amber-400
                                           hover:bg-amber-500/10 transition-colors"
                                title={t("Disable")}
                                aria-label={t("Disable")}
                              >
                                <Ban size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => setConfirm({ kind: "delete", student })}
                              className="rounded-lg p-1.5 text-red-600 dark:text-red-400
                                         hover:bg-red-500/10 transition-colors"
                              title={t("Delete")}
                              aria-label={t("Delete")}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Enroll dialog */}
      {enrollDialogOpen && enrollTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4"
          onClick={() => !actionBusy && setEnrollDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
          >
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">
              {t("Enroll in course")}
            </h2>
            <p className="mb-4 text-sm text-[var(--muted-foreground)]">
              {t("Select a course to enroll {{name}} into:", { name: enrollTarget.username })}
            </p>
            <select
              value={enrollCourseId}
              onChange={(e) => setEnrollCourseId(e.target.value)}
              className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm
                         text-[var(--foreground)] outline-none focus:border-[var(--ring)] transition-colors"
            >
              <option value="">{t("Select course…")}</option>
              {allCourses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEnrollDialogOpen(false)}
                disabled={actionBusy}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={handleEnroll}
                disabled={!enrollCourseId || actionBusy}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium
                           text-[var(--background)] disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {actionBusy ? t("Enrolling…") : t("Enroll")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog for destructive actions */}
      <ConfirmDialog
        open={confirm !== null && confirm.kind !== "bulk_enroll"}
        title={
          confirm?.kind === "delete" ? t("Delete user")
          : confirm?.kind === "disable" ? t("Disable user")
          : confirm?.kind === "enable" ? t("Enable user")
          : confirm?.kind === "unenroll" ? t("Unenroll student")
          : confirm?.kind === "bulk_disable" ? t("Disable users")
          : confirm?.kind === "bulk_delete" ? t("Delete users")
          : ""
        }
        confirmLabel={
          confirm?.kind === "delete" ? t("Delete")
          : confirm?.kind === "disable" ? t("Disable")
          : confirm?.kind === "enable" ? t("Enable")
          : confirm?.kind === "unenroll" ? t("Unenroll")
          : confirm?.kind === "bulk_disable" ? t("Disable all")
          : confirm?.kind === "bulk_delete" ? t("Delete all")
          : ""
        }
        tone={
          confirm?.kind === "delete" || confirm?.kind === "bulk_delete" || confirm?.kind === "unenroll"
            ? "danger"
            : "default"
        }
        busy={actionBusy}
        busyLabel={t("Working…")}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === "delete" && confirm.student && (
          <p>{t("Delete {{name}}? This cannot be undone.", { name: confirm.student.username })}</p>
        )}
        {confirm?.kind === "disable" && confirm.student && (
          <p>{t("Disable {{name}}? They will not be able to log in. Their data is preserved.", { name: confirm.student.username })}</p>
        )}
        {confirm?.kind === "enable" && confirm.student && (
          <p>{t("Enable {{name}}? They will be able to log in again.", { name: confirm.student.username })}</p>
        )}
        {confirm?.kind === "unenroll" && confirm.student && confirm.courseName && (
          <p>{t("Unenroll {{name}} from {{course}}? Their submission data is preserved.", { name: confirm.student.username, course: confirm.courseName })}</p>
        )}
        {confirm?.kind === "bulk_disable" && (
          <p>{t("Disable {{count}} selected students? They will not be able to log in.", { count: selectedCount })}</p>
        )}
        {confirm?.kind === "bulk_delete" && (
          <p>{t("Delete {{count}} selected students? This cannot be undone.", { count: selectedCount })}</p>
        )}
      </ConfirmDialog>

      {/* Confirm dialog for bulk enroll */}
      <ConfirmDialog
        open={confirm?.kind === "bulk_enroll"}
        title={t("Enroll students")}
        confirmLabel={t("Enroll")}
        busy={actionBusy}
        busyLabel={t("Enrolling…")}
        onConfirm={handleBulkEnroll}
        onCancel={() => setConfirm(null)}
      >
        <p>
          {t("Enroll {{count}} students into {{course}}?", {
            count: selectedCount,
            course: allCourses.find((c) => c.id === bulkEnrollCourseId)?.name ?? "",
          })}
        </p>
      </ConfirmDialog>
    </>
  );
}

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
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div>
      {sublabel && (
        <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{sublabel}</div>
      )}
    </div>
  );
}
