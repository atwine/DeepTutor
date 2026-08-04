"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  createAssignment,
  deleteAssignment,
  listAssignments,
  listSubmissionsPaged,
  publishAssignment,
  unpublishAssignment,
  type AssignmentDraft,
  type AssignmentSummary,
  type Question,
  type QuestionType,
  type SubmissionWithStudent,
} from "@/lib/assignments-api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/common/Pagination";
import {
  ArrowLeft,
  ClipboardList,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { formatDate as formatLocaleDate, type Language } from "@/lib/datetime";

function formatDate(iso: string, lang: Language): string {
  if (!iso) return "—";
  try {
    return formatLocaleDate(new Date(iso), lang);
  } catch {
    return "—";
  }
}

type DraftQuestion = Omit<Question, "question_id">;

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "choice", label: "Multiple choice" },
  { value: "concept", label: "True / False" },
  { value: "fill_in_blank", label: "Fill in the blank" },
  { value: "short_answer", label: "Short answer" },
  { value: "written", label: "Written / essay" },
  { value: "coding", label: "Coding" },
];

function emptyQuestion(): DraftQuestion {
  return {
    question: "",
    question_type: "short_answer",
    options: null,
    correct_answer: "",
    explanation: "",
    points: 1,
  };
}

export default function CourseUnitAssignmentsPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("1");
  const [attemptLimit, setAttemptLimit] = useState("1");
  const [dueAt, setDueAt] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  // Round 3: retake policy fields.
  const [isMajor, setIsMajor] = useState(false);
  const [passingScoreEnabled, setPassingScoreEnabled] = useState(false);
  const [passingScore, setPassingScore] = useState("70");
  // Round 3: timed-assignment fields — is_timed/time_limit_minutes already
  // existed on the model and are already read/enforced by the student
  // briefing screen; this form previously had no way to set them at all.
  const [isTimed, setIsTimed] = useState(false);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState("30");
  // Issue #32: optional/bonus assignments don't block course completion.
  const [isOptional, setIsOptional] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AssignmentSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null);
  // A6: hide "New assignment" button if user doesn't manage this unit
  // (inferred from whether any non-published assignments are visible —
  // the list endpoint returns all statuses only for managers).
  const [canManage, setCanManage] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithStudent[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [submissionsOffset, setSubmissionsOffset] = useState(0);
  const SUBMISSIONS_PAGE_LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listAssignments(courseUnitId);
      setAssignments(data);
      // A6: if any assignment has status "draft", user is a manager.
      // If all are "published" or list is empty, we can't be sure — assume
      // manager (since they navigated here from the admin panel).
      // If the list fails with 403, they definitely can't manage.
      setCanManage(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // This page is only reached by an admin/instructor (see the role
      // redirect below), so the only 403 this endpoint can actually raise
      // here is the instructor-doesn't-manage-this-unit case — matches the
      // unified error copy from assignments_router.py's
      // _enrollment_error_detail (see gradebook page for the same wording).
      if (msg.includes("do not manage") || msg.includes("not enrolled") || msg.includes("403")) {
        setCanManage(false);
      }
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
      if (status.role !== "admin" && status.role !== "instructor") {
        router.replace("/");
        return;
      }
      void load();
    });
  }, [router, load]);

  function resetCreateForm() {
    setTitle("");
    setDescription("");
    setWeight("1");
    setAttemptLimit("1");
    setDueAt("");
    setQuestions([emptyQuestion()]);
    setIsMajor(false);
    setPassingScoreEnabled(false);
    setPassingScore("70");
    setIsTimed(false);
    setTimeLimitMinutes("30");
    setIsOptional(false);
    setCreateError("");
  }

  function openCreate() {
    resetCreateForm();
    setShowCreate(true);
  }

  function closeCreate() {
    if (creating) return;
    setShowCreate(false);
  }

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, emptyQuestion()]);
  }

  function removeQuestion(index: number) {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function updateOption(index: number, key: string, value: string) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === index ? { ...q, options: { ...(q.options ?? {}), [key]: value } } : q,
      ),
    );
  }

  function addOption(index: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        const existing = q.options ?? {};
        const nextKey = String.fromCharCode(65 + Object.keys(existing).length);
        return { ...q, options: { ...existing, [nextKey]: "" } };
      }),
    );
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setCreateError(t("Title is required."));
      return;
    }
    const cleanedQuestions = questions
      .map((q) => ({ ...q, question: q.question.trim() }))
      .filter((q) => q.question);
    if (cleanedQuestions.length === 0) {
      setCreateError(t("Add at least one question."));
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const draft: AssignmentDraft = {
        title: trimmedTitle,
        description: description.trim(),
        questions: cleanedQuestions,
        weight: parseFloat(weight) || 1,
        // Round 3: a major assignment is hard-capped at 1 attempt — force it
        // here too (not just visually) so the stored value matches what the
        // server will enforce as the effective limit either way.
        attempt_limit: isMajor ? 1 : parseInt(attemptLimit, 10) || 1,
        due_at: dueAt,
        is_major: isMajor,
        passing_score: !isMajor && passingScoreEnabled ? parseFloat(passingScore) || 0 : null,
        is_timed: isTimed,
        time_limit_minutes: isTimed ? parseInt(timeLimitMinutes, 10) || 1 : null,
        is_optional: isOptional,
      };
      await createAssignment(courseUnitId, draft);
      setShowCreate(false);
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("Failed to create assignment"));
    } finally {
      setCreating(false);
    }
  }

  async function handlePublish(assignment: AssignmentSummary) {
    setPublishBusyId(assignment.id);
    setActionError("");
    try {
      await publishAssignment(assignment.id);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to publish assignment"));
    } finally {
      setPublishBusyId(null);
    }
  }

  async function handleUnpublish(assignment: AssignmentSummary) {
    setPublishBusyId(assignment.id);
    setActionError("");
    try {
      await unpublishAssignment(assignment.id);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to unpublish assignment"));
    } finally {
      setPublishBusyId(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setActionError("");
    try {
      await deleteAssignment(deleteTarget.id);
      setAssignments((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to delete assignment"));
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function toggleSubmissions(assignment: AssignmentSummary) {
    if (expandedId === assignment.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(assignment.id);
    setSubmissionsOffset(0);
    setSubmissionsLoading(true);
    try {
      const paged = await listSubmissionsPaged(assignment.id, SUBMISSIONS_PAGE_LIMIT, 0);
      setSubmissions(paged.items);
      setSubmissionsTotal(paged.total);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to load submissions"));
    } finally {
      setSubmissionsLoading(false);
    }
  }

  async function loadSubmissionsPage(assignmentId: string, offset: number) {
    setSubmissionsLoading(true);
    try {
      const paged = await listSubmissionsPaged(assignmentId, SUBMISSIONS_PAGE_LIMIT, offset);
      setSubmissions(paged.items);
      setSubmissionsTotal(paged.total);
      setSubmissionsOffset(offset);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to load submissions"));
    } finally {
      setSubmissionsLoading(false);
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
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
                {t("Assignments")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Create graded assignments and review submitted scores")}
              </p>
            </div>
            {canManage && (
              <button
                onClick={openCreate}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                           border border-[var(--border)] text-[var(--foreground)]
                           hover:bg-[var(--card)] transition-colors"
              >
                <Plus size={14} />
                {t("New assignment")}
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
              {t("Loading…")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : assignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <ClipboardList
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No assignments yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("Create one to get started.")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {assignments.map((a) => (
                <div key={a.id}>
                  <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-[var(--foreground)]">{a.title}</p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            a.status === "published"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-[var(--muted)]/60 text-[var(--muted-foreground)]"
                          }`}
                        >
                          {a.status === "published" ? t("Published") : t("Draft")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {a.question_count === 1
                          ? t("1 question")
                          : t("{{count}} questions", { count: a.question_count })}
                        {" · "}{t("weight {{weight}}", { weight: a.weight })}
                        {" · "}{a.attempt_limit === 1
                          ? t("1 attempt")
                          : t("{{count}} attempts", { count: a.attempt_limit })}
                        {" · "}{t("created {{date}}", { date: formatDate(a.created_at, lang) })}
                        {a.is_major
                          ? ` · ${t("major (no retakes)")}`
                          : a.passing_score != null
                            ? ` · ${t("passing score {{score}}%", { score: a.passing_score })}`
                            : ""}
                        {a.is_timed && a.time_limit_minutes
                          ? ` · ${t("{{min}} min timed", { min: a.time_limit_minutes })}`
                          : ""}
                        {a.is_optional
                          ? ` · ${t("optional")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => void toggleSubmissions(a)}
                        title={t("View submissions")}
                        className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                   hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                      >
                        <Users size={15} />
                      </button>
                      {a.status === "draft" && (
                        <button
                          onClick={() => void handlePublish(a)}
                          disabled={publishBusyId === a.id}
                          title={t("Publish")}
                          className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                     hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                     disabled:opacity-40 transition-colors"
                        >
                          <Send size={15} />
                        </button>
                      )}
                      {a.status === "published" && (
                        <button
                          onClick={() => void handleUnpublish(a)}
                          disabled={publishBusyId === a.id}
                          title={t("Unpublish (revert to draft)")}
                          className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                     hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                     disabled:opacity-40 transition-colors"
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(a)}
                        title={t("Delete")}
                        className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                   hover:bg-red-500/10 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {expandedId === a.id && (
                    <div className="border-t border-[var(--border)] bg-[var(--background)]/40 p-4">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        {t("Submissions")} {!submissionsLoading && `(${submissionsTotal})`}
                      </p>
                      {submissionsLoading ? (
                        <p className="text-xs text-[var(--muted-foreground)]">{t("Loading…")}</p>
                      ) : submissions.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {t("No submissions yet.")}
                        </p>
                      ) : (
                        <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                          {submissions.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[var(--foreground)]">
                                  {s.full_name || s.username}
                                </p>
                                <p className="truncate text-xs text-[var(--muted-foreground)]">
                                  {s.username}
                                  {s.registration_number ? ` · ${s.registration_number}` : ""}
                                  {" · "}
                                  {formatDate(s.submitted_at, lang)}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-[var(--muted)]/60 px-2.5 py-1 text-xs font-medium text-[var(--foreground)]">
                                {s.score.toFixed(1)} / {s.max_score.toFixed(1)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {submissionsTotal > SUBMISSIONS_PAGE_LIMIT && expandedId && (
                        <div className="mt-2">
                          <Pagination
                            total={submissionsTotal}
                            limit={SUBMISSIONS_PAGE_LIMIT}
                            offset={submissionsOffset}
                            disabled={submissionsLoading}
                            onPageChange={(newOffset) => {
                              if (expandedId) void loadSubmissionsPage(expandedId, newOffset);
                            }}
                          />
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

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("Delete assignment")}
        tone="danger"
        confirmLabel={t("Delete")}
        busyLabel={t("Deleting…")}
        busy={deleteBusy}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      >
        {deleteTarget && (
          <p>
            {t(
              "This permanently removes “{{title}}” and every student's submission to it. This cannot be undone.",
              { title: deleteTarget.title },
            )}
          </p>
        )}
      </ConfirmDialog>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4 py-8"
          role="dialog"
          aria-modal="true"
          onClick={closeCreate}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateSubmit}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {t("New assignment")}
              </h2>
              <button
                type="button"
                onClick={closeCreate}
                disabled={creating}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label={t("Close")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
                {t("Title")}
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={creating}
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </label>

              <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
                {t("Description")}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={creating}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </label>

              <div className="mb-4 grid grid-cols-3 gap-3">
                <label className="block text-xs text-[var(--muted-foreground)]">
                  {t("Weight")}
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    disabled={creating}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  />
                </label>
                <label className="block text-xs text-[var(--muted-foreground)]">
                  {t("Attempt limit")}
                  <input
                    type="number"
                    min="1"
                    value={isMajor ? 1 : attemptLimit}
                    onChange={(e) => setAttemptLimit(e.target.value)}
                    disabled={creating || isMajor}
                    title={isMajor ? t("Major assignments are limited to 1 attempt.") : undefined}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] disabled:opacity-50"
                  />
                </label>
                <label className="block text-xs text-[var(--muted-foreground)]">
                  {t("Due date")}
                  <input
                    type="date"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    disabled={creating}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  />
                </label>
              </div>

              <div className="mb-4 space-y-2 rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {t("Retake policy")}
                </p>
                <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={isMajor}
                    onChange={(e) => {
                      setIsMajor(e.target.checked);
                      if (e.target.checked) setPassingScoreEnabled(false);
                    }}
                    disabled={creating}
                  />
                  {t("Major assignment (no retakes)")}
                </label>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("Hard-caps this assignment to 1 attempt, no matter what attempt limit is set above.")}
                </p>

                {!isMajor && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                      <input
                        type="checkbox"
                        checked={passingScoreEnabled}
                        onChange={(e) => setPassingScoreEnabled(e.target.checked)}
                        disabled={creating}
                      />
                      {t("Require a passing score to stop retakes")}
                    </label>
                    {passingScoreEnabled && (
                      <label className="block text-xs text-[var(--muted-foreground)]">
                        {t("Passing score (%)")}
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={passingScore}
                          onChange={(e) => setPassingScore(e.target.value)}
                          disabled={creating}
                          className="mt-1 w-32 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                        <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
                          {t("Once a student's most recent score meets this, further submissions are blocked even if attempts remain.")}
                        </span>
                      </label>
                    )}
                  </>
                )}
              </div>

              <div className="mb-4 space-y-2 rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {t("Timing")}
                </p>
                <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={isTimed}
                    onChange={(e) => setIsTimed(e.target.checked)}
                    disabled={creating}
                  />
                  {t("Timed assignment")}
                </label>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("Students see a countdown once they start; answers auto-submit when time runs out.")}
                </p>
                {isTimed && (
                  <label className="block text-xs text-[var(--muted-foreground)]">
                    {t("Time limit (minutes)")}
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={timeLimitMinutes}
                      onChange={(e) => setTimeLimitMinutes(e.target.value)}
                      disabled={creating}
                      className="mt-1 w-32 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                    />
                  </label>
                )}
              </div>

              <div className="mb-4 space-y-2 rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {t("Optional / Bonus")}
                </p>
                <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={isOptional}
                    onChange={(e) => setIsOptional(e.target.checked)}
                    disabled={creating}
                  />
                  {t("Optional assignment (doesn't block completion)")}
                </label>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("Students who skip this assignment can still be marked complete for the course.")}
                </p>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {t("Questions")}
                </p>
                <button
                  type="button"
                  onClick={addQuestion}
                  disabled={creating}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                             border border-[var(--border)] text-[var(--foreground)]
                             hover:bg-[var(--background)] disabled:opacity-40 transition-colors"
                >
                  <Plus size={12} />
                  {t("Add question")}
                </button>
              </div>

              <div className="space-y-3">
                {questions.map((q, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-[var(--border)] p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--muted-foreground)]">
                        {t("Question {{n}}", { n: index + 1 })}
                      </span>
                      {questions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeQuestion(index)}
                          disabled={creating}
                          className="rounded p-1 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    <textarea
                      value={q.question}
                      onChange={(e) => updateQuestion(index, { question: e.target.value })}
                      disabled={creating}
                      rows={2}
                      placeholder={t("Question text")}
                      className="mb-2 w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                    />

                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <select
                        value={q.question_type}
                        onChange={(e) =>
                          updateQuestion(index, {
                            question_type: e.target.value as QuestionType,
                            options: e.target.value === "choice" ? (q.options ?? {}) : null,
                          })
                        }
                        disabled={creating}
                        className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                      >
                        {QUESTION_TYPES.map((qt) => (
                          <option key={qt.value} value={qt.value}>
                            {t(qt.label)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={q.points}
                        onChange={(e) =>
                          updateQuestion(index, { points: parseFloat(e.target.value) || 1 })
                        }
                        disabled={creating}
                        placeholder={t("Points")}
                        className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                      />
                    </div>

                    {q.question_type === "choice" && (
                      <div className="mb-2 space-y-1.5">
                        {Object.entries(q.options ?? {}).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="w-5 shrink-0 text-xs text-[var(--muted-foreground)]">
                              {key}.
                            </span>
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => updateOption(index, key, e.target.value)}
                              disabled={creating}
                              className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addOption(index)}
                          disabled={creating}
                          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
                        >
                          {t("+ Add option")}
                        </button>
                      </div>
                    )}

                    <input
                      type="text"
                      value={q.correct_answer}
                      onChange={(e) => updateQuestion(index, { correct_answer: e.target.value })}
                      disabled={creating}
                      placeholder={
                        q.question_type === "choice"
                          ? t("Correct option key (e.g. B)")
                          : q.question_type === "concept"
                            ? t("true or false")
                            : t("Correct / model answer")
                      }
                      className="mb-2 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                    />

                    <input
                      type="text"
                      value={q.explanation}
                      onChange={(e) => updateQuestion(index, { explanation: e.target.value })}
                      disabled={creating}
                      placeholder={t("Explanation shown after grading (optional)")}
                      className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                    />
                  </div>
                ))}
              </div>

              {createError && <p className="mt-3 text-xs text-red-500">{createError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <button
                type="button"
                onClick={closeCreate}
                disabled={creating}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
              >
                {creating ? t("Creating…") : t("Create as draft")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
