"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getInsights,
  insightsExportUrl,
  type InsightsResponse,
  type InsightsBreakdown,
} from "@/lib/admin-api";
import {
  ArrowLeft,
  Users,
  GraduationCap,
  TrendingUp,
  UserMinus,
  Download,
  RefreshCw,
} from "lucide-react";

// Categorical slots 1 (blue) and 2 (orange) from the shared dataviz palette —
// a pre-validated, colorblind-safe pair, used in this fixed order everywhere
// a two-category split appears on this page (gender, degree type).
const SERIES_1 = "#3987e5"; // blue
const SERIES_2 = "#d95926"; // orange

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

/** A single categorical breakdown shown as one thin proportion bar (part-to-
 * whole across exactly two named categories, plus "Unspecified") with a
 * legend below carrying the counts and percentages as text — color marks
 * identity, but the actual numbers are always visible next to it, never
 * color-only. */
function BreakdownPanel({
  title,
  breakdown,
  categoryOrder,
  t,
}: {
  title: string;
  breakdown: InsightsBreakdown;
  categoryOrder: string[];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const colors = [SERIES_1, SERIES_2];
  const segments = categoryOrder
    .map((label, i) => ({
      label,
      color: colors[i] ?? "var(--muted-foreground)",
      count: breakdown.counts[label] ?? 0,
      pct: breakdown.percentages[label] ?? 0,
    }))
    .filter((s) => s.count > 0);
  const unspecified = breakdown.counts["Unspecified"] ?? 0;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          {title}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          {t("{{count}} total", { count: breakdown.total })}
        </span>
      </div>

      {breakdown.total === 0 ? (
        <p className="py-3 text-sm text-[var(--muted-foreground)]">{t("No data yet")}</p>
      ) : (
        <>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
            {segments.map((s) => (
              <div
                key={s.label}
                className="h-full rounded-full"
                style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                title={`${s.label}: ${s.pct}%`}
              />
            ))}
            {unspecified > 0 && (
              <div
                className="h-full rounded-full bg-[var(--border)]"
                style={{ width: `${breakdown.percentages["Unspecified"]}%` }}
                title={`${t("Unspecified")}: ${breakdown.percentages["Unspecified"]}%`}
              />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 text-sm">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-[var(--foreground)]">{t(s.label)}</span>
                <span className="text-[var(--muted-foreground)]">
                  {s.count} ({s.pct}%)
                </span>
              </div>
            ))}
            {unspecified > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--border)]" />
                <span className="text-[var(--foreground)]">{t("Unspecified")}</span>
                <span className="text-[var(--muted-foreground)]">
                  {unspecified} ({breakdown.percentages["Unspecified"]}%)
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Per-course completion ranking — one thin horizontal bar per course, a
 * single sequential hue (magnitude, not identity), sorted so the highest
 * and lowest completion rates are immediately visible without a separate
 * "top/bottom" list to keep in sync. */
function CourseCompletionList({
  courses,
  t,
}: {
  courses: InsightsResponse["per_course"];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (courses.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
        {t("No courses in this term.")}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {courses.map((c) => (
        <div key={c.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-[var(--foreground)]">{c.name}</span>
            <span className="shrink-0 text-[var(--muted-foreground)]">
              {t("{{completed}}/{{enrolled}} completed", {
                completed: c.completed,
                enrolled: c.enrolled,
              })}
              {c.withdrawn > 0 &&
                ` · ${t("{{count}} withdrawn", { count: c.withdrawn })}`}
              {" · "}
              <span className="font-medium text-[var(--foreground)]">{c.completion_rate}%</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]/50">
            <div
              className="h-full rounded-full"
              style={{ width: `${c.completion_rate}%`, backgroundColor: SERIES_1 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminInsightsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (selectedTerm: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await getInsights(selectedTerm || undefined);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load insights"));
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
      void load("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function handleTermChange(newTerm: string) {
    setTerm(newTerm);
    void load(newTerm);
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-4xl">
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
                href="/admin/students"
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                {t("Student Dashboard")} →
              </Link>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Insights")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Org-wide numbers — who's enrolled, and how courses are completing.")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={insightsExportUrl(term)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                           border border-[var(--border)] text-[var(--foreground)]
                           hover:bg-[var(--card)] transition-colors"
              >
                <Download size={14} />
                {t("Export CSV")}
              </a>
              <button
                onClick={() => load(term)}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                           border border-[var(--border)] text-[var(--muted-foreground)]
                           hover:text-[var(--foreground)] hover:bg-[var(--card)]
                           disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                {t("Refresh")}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {data && data.terms.length > 0 && (
          <div className="mb-5">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              {t("Term")}
            </label>
            <select
              value={term}
              onChange={(e) => handleTermChange(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm
                         text-[var(--foreground)] outline-none focus:border-[var(--ring)] transition-colors"
            >
              <option value="">{t("All terms")}</option>
              {data.terms.map((term_) => (
                <option key={term_} value={term_}>
                  {term_}
                </option>
              ))}
            </select>
          </div>
        )}

        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)]"
              />
            ))}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                icon={<Users size={14} />}
                label={t("Students")}
                value={data.stats.total_students}
              />
              <StatCard
                icon={<GraduationCap size={14} />}
                label={t("Courses")}
                value={data.stats.total_courses}
                sublabel={t("{{count}} enrolled", { count: data.stats.total_enrolled })}
              />
              <StatCard
                icon={<TrendingUp size={14} />}
                label={t("Overall completion")}
                value={`${data.stats.overall_completion_rate}%`}
                sublabel={t("{{count}} completed", { count: data.stats.total_completed })}
              />
              <StatCard
                icon={<UserMinus size={14} />}
                label={t("Withdrawn")}
                value={data.stats.total_withdrawn}
                sublabel={t("across all courses")}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BreakdownPanel
                title={t("Gender")}
                breakdown={data.gender_breakdown}
                categoryOrder={["Male", "Female"]}
                t={t}
              />
              <BreakdownPanel
                title={t("Course type")}
                breakdown={data.course_type_breakdown}
                categoryOrder={["Masters", "PhD"]}
                t={t}
              />
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {t("Completion rate by course")}
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t("Highest to lowest")}
                </span>
              </div>
              <CourseCompletionList courses={data.per_course} t={t} />
            </div>
          </>
        ) : null}

        <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">
          {t("DeepTutor Admin · Insights")}
        </p>
      </div>
    </div>
  );
}
