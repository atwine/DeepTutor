"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import { bookApi } from "@/lib/book-api";
import type { Book } from "@/lib/book-types";
import {
  assignBookToCourseUnit,
  listCourseUnitBooks,
  publishCourseBook,
  unassignBookFromCourseUnit,
  unpublishCourseBook,
  type CourseBookSummary,
} from "@/lib/course-books-api";
import { ArrowLeft, BookOpen, Plus, Send, Undo2, X } from "lucide-react";
import Link from "next/link";

export default function CourseUnitNotesPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t } = useTranslation();

  const [assigned, setAssigned] = useState<CourseBookSummary[]>([]);
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAssign, setShowAssign] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [assignedBooks, ownBooks] = await Promise.all([
        listCourseUnitBooks(courseUnitId),
        bookApi.list(),
      ]);
      setAssigned(assignedBooks);
      setMyBooks(ownBooks.books);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load course notes"));
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

  const assignedIds = new Set(assigned.map((b) => b.book_id));
  const availableBooks = myBooks.filter((b) => !assignedIds.has(b.id));

  function openAssign() {
    setSelectedBookId(availableBooks[0]?.id ?? "");
    setActionError("");
    setShowAssign(true);
  }

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedBookId || assigning) return;
    setAssigning(true);
    setActionError("");
    try {
      await assignBookToCourseUnit(selectedBookId, courseUnitId);
      setShowAssign(false);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to assign book"));
    } finally {
      setAssigning(false);
    }
  }

  async function handlePublishToggle(book: CourseBookSummary) {
    setBusyId(book.book_id);
    setActionError("");
    try {
      if (book.status === "published") {
        await unpublishCourseBook(book.book_id);
      } else {
        await publishCourseBook(book.book_id);
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to update"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnassign(book: CourseBookSummary) {
    setBusyId(book.book_id);
    setActionError("");
    try {
      await unassignBookFromCourseUnit(book.book_id);
      setAssigned((prev) => prev.filter((b) => b.book_id !== book.book_id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to remove book"));
    } finally {
      setBusyId(null);
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
                {t("Course Notes")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {t("Publish books from your library so enrolled students can read them")}
              </p>
            </div>
            <button
              onClick={openAssign}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                         border border-[var(--border)] text-[var(--foreground)]
                         hover:bg-[var(--card)] transition-colors"
            >
              <Plus size={14} />
              {t("Assign a book")}
            </button>
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
          ) : assigned.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <BookOpen size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No notes assigned yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t(
                  "Write a book in your Book Library, then assign it here to share it with this course unit.",
                )}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {assigned.map((book) => (
                <div key={book.book_id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-[var(--foreground)]">
                        {book.title || t("Untitled")}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          book.status === "published"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-[var(--muted)]/60 text-[var(--muted-foreground)]"
                        }`}
                      >
                        {book.status === "published" ? t("Published") : t("Draft")}
                      </span>
                    </div>
                    {book.description && (
                      <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                        {book.description}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {t("{{count}} chapters", { count: book.chapter_count })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => void handlePublishToggle(book)}
                      disabled={busyId === book.book_id}
                      title={book.status === "published" ? t("Unpublish") : t("Publish")}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                                 border border-[var(--border)] text-[var(--foreground)]
                                 hover:bg-[var(--background)] disabled:opacity-40 transition-colors"
                    >
                      {book.status === "published" ? <Undo2 size={12} /> : <Send size={12} />}
                      {book.status === "published" ? t("Unpublish") : t("Publish")}
                    </button>
                    <button
                      onClick={() => void handleUnassign(book)}
                      disabled={busyId === book.book_id}
                      title={t("Remove from this course unit")}
                      className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                 hover:bg-red-500/10 hover:text-red-500
                                 disabled:opacity-40 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-[var(--muted-foreground)]">
          {t("Books themselves are written and edited in your")}{" "}
          <Link href="/book" className="underline hover:text-[var(--foreground)]">
            {t("Book Library")}
          </Link>
          .
        </p>
      </div>

      {showAssign && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !assigning && setShowAssign(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAssign}
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {t("Assign a book")}
              </h2>
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                disabled={assigning}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label={t("Close")}
              >
                <X size={16} />
              </button>
            </div>

            {availableBooks.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                {t(
                  "Every book in your library is already assigned here, or you haven't written one yet.",
                )}
              </p>
            ) : (
              <label className="mb-4 block text-xs text-[var(--muted-foreground)]">
                {t("Book")}
                <select
                  value={selectedBookId}
                  onChange={(e) => setSelectedBookId(e.target.value)}
                  disabled={assigning}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  {availableBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title || t("Untitled")}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {actionError && <p className="mb-3 text-xs text-red-500">{actionError}</p>}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                disabled={assigning}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={assigning || availableBooks.length === 0}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
              >
                {assigning ? t("Assigning…") : t("Assign")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
