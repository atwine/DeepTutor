"use client";

import { useTranslation } from "react-i18next";
import { Check, X as XIcon } from "lucide-react";
import type { Submission } from "@/lib/assignments-api";

/** Per-question + overall score feedback for a graded submission. Shared
 * between the dedicated post-submit results page
 * (`web/app/(utility)/courses/[courseUnitId]/assignments/[assignmentId]/results/page.tsx`)
 * and the assignment list page's compact "your last attempt" summary — same
 * content, two places it's shown, so it lives here once. */
export function ResultView({ submission }: { submission: Submission }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-[var(--muted)]/40 px-3 py-2 text-sm font-medium text-[var(--foreground)]">
        {t("Score")}: {submission.score.toFixed(1)} / {submission.max_score.toFixed(1)}
      </div>
      {submission.question_results.map((r) => (
        <div key={r.question_id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[var(--foreground)]">{r.question}</p>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                r.is_correct
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-600 dark:text-red-400"
              }`}
            >
              {r.is_correct ? <Check size={11} /> : <XIcon size={11} />}
              {r.score.toFixed(1)} / {r.max_score.toFixed(1)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
            {t("Your answer")}: {r.user_answer || t("(no answer)")}
          </p>
          {r.feedback && (
            <p className="mt-1.5 whitespace-pre-wrap text-xs text-[var(--muted-foreground)]">
              {r.feedback}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
