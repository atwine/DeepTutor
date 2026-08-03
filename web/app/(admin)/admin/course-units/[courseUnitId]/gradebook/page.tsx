"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import { getGradebook, gradebookExportUrl, type Gradebook } from "@/lib/gradebook-api";
import { ArrowLeft, Check, Download, GraduationCap, RefreshCw } from "lucide-react";
import Link from "next/link";

function formatScore(result: { score: number | null; max_score: number } | undefined): string {
  if (!result || result.score === null) return "—";
  return `${result.score.toFixed(1)}/${result.max_score.toFixed(1)}`;
}

export default function CourseUnitGradebookPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t } = useTranslation();

  const [gradebook, setGradebook] = useState<Gradebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setGradebook(await getGradebook(courseUnitId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load gradebook"));
    } finally {
      setLoading(false);
    }
  }, [courseUnitId, t]);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin" && status.role !== "instructor") {
        router.replace("/");
        return;
      }
      void load();
    });
  }, [router, load]);

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <Link
            href="/admin/course-units"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back to Course Units")}
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Gradebook")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Every enrolled student's scores across published assignments")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={gradebookExportUrl(courseUnitId)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                           border border-[var(--border)] text-[var(--foreground)]
                           hover:bg-[var(--card)] transition-colors"
              >
                <Download size={14} />
                {t("Export CSV")}
              </a>
              <button
                onClick={() => void load()}
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

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
              {t("Loading…")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : !gradebook || gradebook.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <GraduationCap
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No enrolled students yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("Enroll students and publish assignments to see scores here.")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">{t("Student")}</th>
                    {gradebook.assignments.map((a) => (
                      <th key={a.id} className="whitespace-nowrap px-4 py-3 font-medium">
                        {a.title}
                        <span className="ml-1 font-normal normal-case text-[var(--muted-foreground)]/70">
                          (w{a.weight})
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium">{t("Final Grade")}</th>
                    <th className="px-4 py-3 font-medium">{t("Completed")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {gradebook.rows.map((row) => {
                    const byId = new Map(row.assignments.map((r) => [r.assignment_id, r]));
                    return (
                      <tr key={row.user_id} className="hover:bg-[var(--background)]/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[var(--foreground)]">
                            {row.full_name || row.username}
                          </p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {row.username}
                            {row.registration_number ? ` · ${row.registration_number}` : ""}
                          </p>
                        </td>
                        {gradebook.assignments.map((a) => (
                          <td key={a.id} className="px-4 py-3 text-[var(--muted-foreground)]">
                            {formatScore(byId.get(a.id))}
                          </td>
                        ))}
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                          {row.final_grade === null ? "—" : `${row.final_grade.toFixed(1)}%`}
                        </td>
                        {/* Issue #4: completion status — checked when all
                         * published assignments are submitted+graded. */}
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">
                          {row.completed_at ? (
                            <span
                              className="flex items-center gap-1 text-blue-600 dark:text-blue-400"
                              title={new Date(row.completed_at).toLocaleString()}
                            >
                              <Check size={14} strokeWidth={2} />
                              {new Date(row.completed_at).toLocaleDateString()}
                            </span>
                          ) : (
                            "—"
                          )}
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
