"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getAssignment,
  listAssignments,
  submitAssignment,
  type AssignmentSummary,
  type StudentAssignmentView,
  type Submission,
} from "@/lib/assignments-api";
import { ArrowLeft, Check, ClipboardList, X as XIcon } from "lucide-react";
import Link from "next/link";

function QuestionInput({
  question,
  value,
  onChange,
  disabled,
}: {
  question: StudentAssignmentView["questions"][number];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (question.question_type === "choice" && question.options) {
    return (
      <div className="space-y-1.5">
        {Object.entries(question.options).map(([key, label]) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)]"
          >
            <input
              type="radio"
              name={question.question_id}
              checked={value === key}
              onChange={() => onChange(key)}
              disabled={disabled}
            />
            <span className="font-medium">{key}.</span> {label}
          </label>
        ))}
      </div>
    );
  }
  if (question.question_type === "concept") {
    return (
      <div className="flex gap-3">
        {["true", "false"].map((option) => (
          <label
            key={option}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)]"
          >
            <input
              type="radio"
              name={question.question_id}
              checked={value === option}
              onChange={() => onChange(option)}
              disabled={disabled}
            />
            {option === "true" ? t("True") : t("False")}
          </label>
        ))}
      </div>
    );
  }
  if (question.question_type === "written" || question.question_type === "coding") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={5}
        className={`w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] ${
          question.question_type === "coding" ? "font-mono" : ""
        }`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
    />
  );
}

function ResultView({ submission }: { submission: Submission }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-3">
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

export default function StudentAssignmentsPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t } = useTranslation();

  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentAssignmentView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAssignments(await listAssignments(courseUnitId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load assignments"));
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
      void load();
    });
  }, [router, load]);

  async function toggleExpand(assignment: AssignmentSummary) {
    if (expandedId === assignment.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(assignment.id);
    setDetail(null);
    setAnswers({});
    setSubmitError("");
    setDetailLoading(true);
    try {
      const full = (await getAssignment(assignment.id)) as StudentAssignmentView;
      setDetail(full);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t("Failed to load assignment"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSubmit() {
    if (!detail || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = detail.questions.map((q) => ({
        question_id: q.question_id,
        answer: answers[q.question_id] ?? "",
      }));
      const submission = await submitAssignment(detail.id, payload);
      setDetail((prev) =>
        prev ? { ...prev, my_attempts: prev.my_attempts + 1, my_latest_submission: submission } : prev,
      );
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t("Failed to submit"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Link
            href="/courses"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back to Course Catalog")}
          </Link>
          <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
            {t("Assignments")}
          </h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-[var(--muted-foreground)] shadow-sm">
            {t("Loading…")}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-red-500 shadow-sm">
            {error}
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center shadow-sm">
            <ClipboardList
              size={28}
              strokeWidth={1.5}
              className="text-[var(--muted-foreground)]/50"
            />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {t("No assignments yet")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Check back once your instructor publishes one.")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map((a) => (
              <div
                key={a.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-medium text-[var(--foreground)]">{a.title}</h2>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {t("{{count}} questions · weight {{weight}}", {
                        count: a.question_count,
                        weight: a.weight,
                      })}
                      {a.due_at ? ` · ${t("due")} ${a.due_at}` : ""}
                    </p>
                    {a.description && (
                      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                        {a.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => void toggleExpand(a)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-sm
                               border border-[var(--border)] text-[var(--foreground)]
                               hover:bg-[var(--background)]/60 transition-colors"
                  >
                    {expandedId === a.id ? t("Hide") : t("View")}
                  </button>
                </div>

                {expandedId === a.id && (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    {detailLoading ? (
                      <p className="text-sm text-[var(--muted-foreground)]">{t("Loading…")}</p>
                    ) : !detail ? null : detail.my_latest_submission ? (
                      <>
                        <ResultView submission={detail.my_latest_submission} />
                        {detail.my_attempts < detail.attempt_limit && (
                          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                            {t("{{used}} of {{limit}} attempts used.", {
                              used: detail.my_attempts,
                              limit: detail.attempt_limit,
                            })}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="space-y-4">
                        {detail.questions.map((q) => (
                          <div key={q.question_id}>
                            <p className="mb-2 text-sm text-[var(--foreground)]">
                              {q.question}{" "}
                              <span className="text-xs text-[var(--muted-foreground)]">
                                ({q.points} {t("pt")})
                              </span>
                            </p>
                            <QuestionInput
                              question={q}
                              value={answers[q.question_id] ?? ""}
                              onChange={(v) =>
                                setAnswers((prev) => ({ ...prev, [q.question_id]: v }))
                              }
                              disabled={submitting}
                            />
                          </div>
                        ))}
                        {submitError && (
                          <p className="text-xs text-red-500">{submitError}</p>
                        )}
                        <button
                          onClick={() => void handleSubmit()}
                          disabled={submitting}
                          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
                        >
                          {submitting ? t("Submitting…") : t("Submit")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
