"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { ArrowLeft, Check, ClipboardList, Clock, X as XIcon } from "lucide-react";
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

  // A4: briefing screen state — student sees info before starting
  const [started, setStarted] = useState(false);
  // A4: timer state for timed assignments
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // A5: submission receipt state
  const [showReceipt, setShowReceipt] = useState(false);

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
      setStarted(false);
      setTimeRemaining(null);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    setExpandedId(assignment.id);
    setDetail(null);
    setAnswers({});
    setSubmitError("");
    setStarted(false);
    setShowReceipt(false);
    setTimeRemaining(null);
    if (timerRef.current) clearInterval(timerRef.current);
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

  function handleStartAssignment() {
    if (!detail) return;
    setStarted(true);
    // A4: start timer for timed assignments
    if (detail.is_timed && detail.time_limit_minutes) {
      const totalSeconds = detail.time_limit_minutes * 60;
      setTimeRemaining(totalSeconds);
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const remaining = totalSeconds - elapsed;
        if (remaining <= 0) {
          setTimeRemaining(0);
          if (timerRef.current) clearInterval(timerRef.current);
          // Auto-submit on time expiry
          void handleSubmit();
        } else {
          setTimeRemaining(remaining);
        }
      }, 1000);
    }
  }

  async function handleSubmit() {
    if (!detail || submitting) return;
    // Stop timer if running
    if (timerRef.current) clearInterval(timerRef.current);
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = detail.questions.map((q) => ({
        question_id: q.question_id,
        answer: answers[q.question_id] ?? "",
      }));
      const submission = await submitAssignment(detail.id, payload);
      // A5: Show receipt briefly before results
      setShowReceipt(true);
      setTimeout(() => {
        setShowReceipt(false);
        setDetail((prev) =>
          prev ? { ...prev, my_attempts: prev.my_attempts + 1, my_latest_submission: submission } : prev,
        );
      }, 2000);
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
                      {a.question_count === 1
                        ? t("1 question")
                        : t("{{count}} questions", { count: a.question_count })}
                      {" · "}{t("weight {{weight}}", { weight: a.weight })}
                      {a.due_at ? ` · ${t("due")} ${a.due_at}` : ""}
                      {a.is_timed && a.time_limit_minutes
                        ? ` · ${t("{{min}} min timed", { min: a.time_limit_minutes })}`
                        : ""}
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
                    ) : !detail ? null : showReceipt ? (
                      /* A5: Brief submission receipt */
                      <div className="flex flex-col items-center py-8 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                          <Check size={24} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                          {t("Submission received")}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {t("Your answers have been recorded. Results loading…")}
                        </p>
                      </div>
                    ) : detail.my_latest_submission ? (
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
                    ) : !started ? (
                      /* A4: Pre-assignment briefing screen */
                      <div className="space-y-4">
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)]/50 p-4">
                          <h3 className="text-sm font-semibold text-[var(--foreground)]">
                            {detail.title}
                          </h3>
                          {detail.description && (
                            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                              {detail.description}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted-foreground)]">
                            <span>
                              {detail.question_count === 1
                                ? t("1 question")
                                : t("{{count}} questions", { count: detail.question_count })}
                            </span>
                            <span>{t("weight {{weight}}", { weight: detail.weight })}</span>
                            <span>
                              {detail.attempt_limit === 1
                                ? t("1 attempt")
                                : t("{{count}} attempts", { count: detail.attempt_limit })}
                            </span>
                            {detail.due_at && <span>{t("due")} {detail.due_at}</span>}
                            {detail.is_timed && detail.time_limit_minutes && (
                              <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {t("{{min}} minutes", { min: detail.time_limit_minutes })}
                              </span>
                            )}
                          </div>
                          {detail.is_timed && detail.time_limit_minutes && (
                            <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">
                              {t("This is a timed assignment. Once you start, you will have {{min}} minutes to complete it. Your answers will be auto-submitted when time expires.", { min: detail.time_limit_minutes })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={handleStartAssignment}
                          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] hover:opacity-90"
                        >
                          {t("Start assignment")}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* A4: Timer display for timed assignments */}
                        {timeRemaining !== null && (
                          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                            timeRemaining <= 60
                              ? "bg-red-500/10 text-red-600 dark:text-red-400"
                              : timeRemaining <= 300
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-[var(--muted)]/40 text-[var(--foreground)]"
                          }`}>
                            <Clock size={14} />
                            {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, "0")} {t("remaining")}
                          </div>
                        )}
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
