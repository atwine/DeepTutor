"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import { getAssignment, type StudentAssignmentView } from "@/lib/assignments-api";
import { ResultView } from "@/components/assignments/ResultView";
import { ArrowLeft, CheckCircle2, Home } from "lucide-react";
import Link from "next/link";

/** Round 3, item 1: a dedicated page a student lands on after finishing an
 * assignment — manual submit or the timer auto-submitting on expiry both
 * navigate here (see the assignments list page's `handleSubmit`) instead of
 * silently swapping a results block into the same page. Shows the score,
 * the same per-question feedback the old inline result rendered, retake
 * eligibility (Round 3, item 2's policy), and clear navigation back to the
 * course's assignment list and to Home. */
export default function AssignmentResultsPage() {
  const params = useParams<{ courseUnitId: string; assignmentId: string }>();
  const { courseUnitId, assignmentId } = params;
  const router = useRouter();
  const { t } = useTranslation();

  const [detail, setDetail] = useState<StudentAssignmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAuthStatus().then(async (status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      try {
        const full = (await getAssignment(assignmentId)) as StudentAssignmentView;
        setDetail(full);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("Failed to load your results"));
      } finally {
        setLoading(false);
      }
    });
  }, [assignmentId, router, t]);

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href={`/courses/${encodeURIComponent(courseUnitId)}/assignments`}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back to assignments")}
          </Link>
          <Link
            href="/home"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <Home size={16} />
            {t("Home")}
          </Link>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
              {t("Loading…")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-sm text-red-500">
              {error}
            </div>
          ) : !detail ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
              {t("Assignment not found")}
            </div>
          ) : !detail.my_latest_submission ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {t("No submission found yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("If you just submitted, this may still be processing.")}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                  <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h1 className="font-serif text-lg font-semibold text-[var(--foreground)]">
                    {t("Submission received")}
                  </h1>
                  <p className="text-sm text-[var(--muted-foreground)]">{detail.title}</p>
                </div>
              </div>

              <ResultView submission={detail.my_latest_submission} />

              <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--background)]/50 px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
                {detail.retake_blocked_reason === "attempt_limit" && (
                  <p>{t("You've used all of your attempts for this assignment.")}</p>
                )}
                {detail.retake_blocked_reason === "already_passed" && (
                  <p>
                    {t(
                      "You've already passed this assignment (passing score {{score}}%), so no further attempts are offered.",
                      { score: detail.passing_score },
                    )}
                  </p>
                )}
                {!detail.retake_blocked_reason && (
                  <p>
                    {t("{{used}} of {{limit}} attempts used. You can try again from the assignments list.", {
                      used: detail.my_attempts,
                      limit: detail.attempt_limit,
                    })}
                  </p>
                )}
              </div>

              <div className="mt-6 flex items-center gap-2">
                <Link
                  href={`/courses/${encodeURIComponent(courseUnitId)}/assignments`}
                  className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] hover:opacity-90"
                >
                  {t("Back to assignments")}
                </Link>
                <Link
                  href="/home"
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--background)]/60"
                >
                  {t("Home")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
