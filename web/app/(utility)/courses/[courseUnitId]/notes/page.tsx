"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  getCourseBookContent,
  listCourseUnitBooks,
  type CourseBookContent,
  type CourseBookSummary,
} from "@/lib/course-books-api";
import type { Page as BookPage } from "@/lib/book-types";
import PageReader from "@/app/(workspace)/book/components/PageReader";
import { ArrowLeft, BookOpen, ChevronLeft } from "lucide-react";
import Link from "next/link";

function BookReader({ content }: { content: CourseBookContent }) {
  const { t } = useTranslation();
  const chapters = content.spine?.chapters ?? [];
  const pagesById = new Map(content.pages.map((p) => [p.id, p]));
  const firstPageId = chapters[0]?.page_ids[0] ?? content.pages[0]?.id ?? null;
  const [activePageId, setActivePageId] = useState<string | null>(firstPageId);

  const activePage: BookPage | null = activePageId ? pagesById.get(activePageId) ?? null : null;

  return (
    <div className="flex gap-4">
      <div className="w-56 shrink-0 space-y-3">
        {chapters.map((chapter) => (
          <div key={chapter.id}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              {chapter.title}
            </p>
            <div className="space-y-0.5">
              {chapter.page_ids.map((pageId) => {
                const page = pagesById.get(pageId);
                if (!page) return null;
                const active = pageId === activePageId;
                return (
                  <button
                    key={pageId}
                    onClick={() => setActivePageId(pageId)}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {page.title || t("Untitled page")}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-sm">
        <PageReader
          page={activePage}
          bookId={content.book.id}
          bookLanguage={content.book.language}
        />
      </div>
    </div>
  );
}

export default function CourseUnitNotesPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t } = useTranslation();

  const [books, setBooks] = useState<CourseBookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [content, setContent] = useState<CourseBookContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBooks(await listCourseUnitBooks(courseUnitId));
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
      void load();
    });
  }, [router, load]);

  async function openBook(book: CourseBookSummary) {
    setOpenBookId(book.book_id);
    setContent(null);
    setContentError("");
    setContentLoading(true);
    try {
      setContent(await getCourseBookContent(book.book_id));
    } catch (e) {
      setContentError(e instanceof Error ? e.message : t("Failed to load notes"));
    } finally {
      setContentLoading(false);
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          {openBookId ? (
            <button
              onClick={() => setOpenBookId(null)}
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <ChevronLeft size={16} />
              {t("Back to Course Notes")}
            </button>
          ) : (
            <Link
              href="/courses/my"
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowLeft size={16} />
              {t("Back to My Course Units")}
            </Link>
          )}
          <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
            {t("Course Notes")}
          </h1>
        </div>

        {openBookId ? (
          contentLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-[var(--muted-foreground)] shadow-sm">
              {t("Loading…")}
            </div>
          ) : contentError ? (
            <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-red-500 shadow-sm">
              {contentError}
            </div>
          ) : content ? (
            <BookReader content={content} />
          ) : null
        ) : loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-[var(--muted-foreground)] shadow-sm">
            {t("Loading…")}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-red-500 shadow-sm">
            {error}
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center shadow-sm">
            <BookOpen size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {t("No notes published yet")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Check back once your instructor publishes course notes.")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {books.map((book) => (
              <button
                key={book.book_id}
                onClick={() => void openBook(book)}
                className="block w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-left shadow-sm transition-colors hover:bg-[var(--background)]/60"
              >
                <h2 className="font-medium text-[var(--foreground)]">
                  {book.title || t("Untitled")}
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {t("{{count}} chapters", { count: book.chapter_count })}
                </p>
                {book.description && (
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                    {book.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
