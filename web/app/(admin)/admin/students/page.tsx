"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getStudentsOverview,
  type StudentOverviewRow,
  type StudentOverviewStats,
} from "@/lib/admin-api";
import { StudentDashboard } from "@/components/admin/StudentDashboard";
import { RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function AdminStudentsPage() {
  const router = useRouter();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StudentOverviewStats | null>(null);
  const [courseOptions, setCourseOptions] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentOverviewRow[]>([]);

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

        <StudentDashboard
          stats={stats}
          courseOptions={courseOptions}
          students={students}
          loading={loading}
          error={error}
          onRefresh={load}
          enableActions
        />
      </div>
    </div>
  );
}
