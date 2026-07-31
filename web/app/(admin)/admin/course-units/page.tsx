"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import { listUsers, type UserRecord } from "@/lib/admin-api";
import {
  listCourseUnits,
  createCourseUnit,
  updateCourseUnit,
  deleteCourseUnit,
  type CourseUnit,
} from "@/lib/course-units-api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RosterEditor } from "./RosterEditor";
import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  RefreshCw,
  ArrowLeft,
  Plus,
  Pencil,
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

interface FormState {
  id: string | null;
  name: string;
  term: string;
  description: string;
  instructorIds: string[];
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  term: "",
  description: "",
  instructorIds: [],
};

export default function CourseUnitsPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [isAdmin, setIsAdmin] = useState(false);
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [instructors, setInstructors] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [form, setForm] = useState<FormState | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CourseUnit | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  const load = useCallback(async (admin: boolean) => {
    setLoading(true);
    setError("");
    try {
      const [unitList, userList] = await Promise.all([
        listCourseUnits(),
        admin ? listUsers() : Promise.resolve<UserRecord[]>([]),
      ]);
      setUnits(unitList);
      setInstructors(userList.filter((u) => u.role === "instructor"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load course units"));
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
      if (status.role !== "admin" && status.role !== "instructor") {
        router.replace("/");
        return;
      }
      const admin = status.role === "admin";
      setIsAdmin(admin);
      void load(admin);
    });
  }, [router, load]);

  function instructorNames(unit: CourseUnit): string {
    if (unit.instructor_usernames.length > 0) {
      return unit.instructor_usernames.join(", ");
    }
    if (unit.instructor_ids.length === 0) return t("Unassigned");
    const byId = new Map(instructors.map((u) => [u.id, u.username]));
    return unit.instructor_ids.map((id) => byId.get(id) ?? id).join(", ");
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setFormError("");
  }

  function openEdit(unit: CourseUnit) {
    setForm({
      id: unit.id,
      name: unit.name,
      term: unit.term,
      description: unit.description,
      instructorIds: [...unit.instructor_ids],
    });
    setFormError("");
  }

  function closeForm() {
    if (formSubmitting) return;
    setForm(null);
  }

  function toggleInstructor(id: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const has = prev.instructorIds.includes(id);
      return {
        ...prev,
        instructorIds: has
          ? prev.instructorIds.filter((x) => x !== id)
          : [...prev.instructorIds, id],
      };
    });
  }

  async function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || formSubmitting) return;
    const name = form.name.trim();
    if (!name) {
      setFormError(t("Name is required."));
      return;
    }
    setFormSubmitting(true);
    setFormError("");
    try {
      if (form.id) {
        await updateCourseUnit(form.id, {
          name,
          term: form.term.trim(),
          description: form.description.trim(),
          instructor_ids: form.instructorIds,
        });
      } else {
        await createCourseUnit(
          name,
          form.term.trim(),
          form.instructorIds,
          form.description.trim(),
        );
      }
      setForm(null);
      await load(isAdmin);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("Failed to save course unit"));
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setActionError("");
    try {
      await deleteCourseUnit(deleteTarget.id);
      setUnits((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to delete course unit"));
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowLeft size={16} />
              {t("Back")}
            </Link>
            {isAdmin && (
              <Link
                href="/admin/users"
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                {t("User Management")} →
              </Link>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Course Units")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {isAdmin
                  ? t("Create course units and assign instructors")
                  : t("Course units you teach")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                             border border-[var(--border)] text-[var(--foreground)]
                             hover:bg-[var(--card)] transition-colors"
                >
                  <Plus size={14} />
                  {t("New course unit")}
                </button>
              )}
              <button
                onClick={() => load(isAdmin)}
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

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="divide-y divide-[var(--border)]" aria-hidden>
              {[0, 1].map((row) => (
                <div key={row} className="flex animate-pulse items-center gap-3 px-5 py-4">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-40 rounded bg-[var(--muted)]/60" />
                    <div className="h-2.5 w-28 rounded bg-[var(--muted)]/40" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : units.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <BookOpen size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No course units yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {isAdmin
                  ? t("Create one to get started.")
                  : t("Units you're assigned to will appear here.")}
              </p>
              {isAdmin && (
                <button
                  onClick={openCreate}
                  className="mt-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                             border border-[var(--border)] text-[var(--foreground)]
                             hover:bg-[var(--background)]/60 transition-colors"
                >
                  <Plus size={14} />
                  {t("New course unit")}
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">{t("Name")}</th>
                  <th className="px-5 py-3 font-medium">{t("Term")}</th>
                  <th className="px-5 py-3 font-medium">{t("Instructor(s)")}</th>
                  <th className="px-5 py-3 font-medium">{t("Created")}</th>
                  <th className="px-5 py-3 font-medium text-right">{t("Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {units.map((unit) => (
                  <Fragment key={unit.id}>
                    <tr className="hover:bg-[var(--background)]/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-[var(--foreground)]">
                        {unit.name}
                      </td>
                      <td className="px-5 py-3 text-[var(--muted-foreground)]">
                        {unit.term || "—"}
                      </td>
                      <td className="px-5 py-3 text-[var(--muted-foreground)]">
                        {instructorNames(unit)}
                      </td>
                      <td className="px-5 py-3 text-[var(--muted-foreground)]">
                        {formatDate(unit.created_at, lang)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() =>
                              setExpandedUnitId((current) =>
                                current === unit.id ? null : unit.id,
                              )
                            }
                            title={t("Manage roster")}
                            className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                     hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <Users size={15} />
                          </button>
                          <Link
                            href={`/admin/course-units/${unit.id}/assignments`}
                            title={t("Assignments")}
                            className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                     hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <ClipboardList size={15} />
                          </Link>
                          <Link
                            href={`/admin/course-units/${unit.id}/gradebook`}
                            title={t("Gradebook")}
                            className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                     hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <GraduationCap size={15} />
                          </Link>
                          <Link
                            href={`/admin/course-units/${unit.id}/notes`}
                            title={t("Course Notes")}
                            className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                     hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <BookOpen size={15} />
                          </Link>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => openEdit(unit)}
                                title={t("Edit")}
                                className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                         hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(unit)}
                                title={t("Delete")}
                                className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                         hover:bg-red-500/10 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedUnitId === unit.id && (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <RosterEditor courseUnitId={unit.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">
          {t("DeepTutor Admin · Course Units")}
        </p>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("Delete course unit")}
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
              "This permanently removes “{{name}}” and its enrollments. This cannot be undone.",
              { name: deleteTarget.name },
            )}
          </p>
        )}
      </ConfirmDialog>

      {form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4"
          role="dialog"
          aria-modal="true"
          onClick={closeForm}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleFormSubmit}
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {form.id ? t("Edit course unit") : t("New course unit")}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                disabled={formSubmitting}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label={t("Close")}
              >
                <X size={16} />
              </button>
            </div>

            <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
              {t("Name")}
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={formSubmitting}
                autoFocus
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
              {t("Term")}
              <input
                type="text"
                value={form.term}
                onChange={(e) => setForm({ ...form, term: e.target.value })}
                disabled={formSubmitting}
                placeholder={t("e.g. 2026 Semester 1")}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
              {t("Description")}
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={formSubmitting}
                rows={3}
                placeholder={t("What this course unit covers — shown to students browsing the catalog.")}
                className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            <div className="mb-4">
              <p className="mb-1.5 text-xs text-[var(--muted-foreground)]">
                {t("Instructor(s)")}
              </p>
              {instructors.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("No instructor accounts yet — promote a user to instructor first.")}
                </p>
              ) : (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                  {instructors.map((instructor) => (
                    <label
                      key={instructor.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-[var(--foreground)] hover:bg-[var(--background)]"
                    >
                      <input
                        type="checkbox"
                        checked={form.instructorIds.includes(instructor.id)}
                        onChange={() => toggleInstructor(instructor.id)}
                        disabled={formSubmitting}
                      />
                      {instructor.username}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {formError && <p className="mb-3 text-xs text-red-500">{formError}</p>}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                disabled={formSubmitting}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={formSubmitting}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
              >
                {formSubmitting
                  ? t("Saving…")
                  : form.id
                    ? t("Save")
                    : t("Create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
