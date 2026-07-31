import { apiFetch, apiUrl } from "@/lib/api";
import type { Book, Page, Spine } from "@/lib/book-types";

export interface CourseBookSummary {
  book_id: string;
  id: string;
  title: string;
  description: string;
  page_count: number;
  chapter_count: number;
  status: "draft" | "published";
}

export interface CourseBookContent {
  book: Book;
  spine: Spine | null;
  pages: Page[];
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? fallback);
  }
  return res.json() as Promise<T>;
}

/** Instructor/admin: every book assigned to this unit (draft + published).
 * Student: published books only, and only if approved-enrolled. */
export async function listCourseUnitBooks(
  courseUnitId: string,
): Promise<CourseBookSummary[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/books`),
  );
  const data = await unwrap<{ books: CourseBookSummary[] }>(
    res,
    "Failed to load course notes",
  );
  return data.books;
}

/** Attach one of the instructor's own books to a course unit (draft). */
export async function assignBookToCourseUnit(
  bookId: string,
  courseUnitId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/books/${encodeURIComponent(bookId)}/course-unit`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_unit_id: courseUnitId }),
    },
  );
  await unwrap<{ entry: unknown }>(res, "Failed to assign book");
}

export async function unassignBookFromCourseUnit(bookId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/books/${encodeURIComponent(bookId)}/course-unit`),
    { method: "DELETE" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to remove book");
}

export async function publishCourseBook(bookId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/books/${encodeURIComponent(bookId)}/publish`),
    { method: "POST" },
  );
  await unwrap<{ entry: unknown }>(res, "Failed to publish");
}

export async function unpublishCourseBook(bookId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/books/${encodeURIComponent(bookId)}/unpublish`),
    { method: "POST" },
  );
  await unwrap<{ entry: unknown }>(res, "Failed to unpublish");
}

/** The actual read: book + spine + pages, for a student (published only) or
 * a managing instructor previewing a draft. */
export async function getCourseBookContent(bookId: string): Promise<CourseBookContent> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/books/${encodeURIComponent(bookId)}/course-content`),
  );
  return unwrap<CourseBookContent>(res, "Failed to load notes");
}
