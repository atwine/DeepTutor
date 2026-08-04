"use client";

/** A single selected book page with its identifying metadata. */
export interface SelectedBookPage {
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageTitle: string;
  chapterId?: string;
  chapterTitle?: string;
}

/** A selected book and its chosen pages, used as a chat attachment. */
export interface SelectedBookReference {
  bookId: string;
  bookTitle: string;
  pages: SelectedBookPage[];
}

/** Wire-format payload for book references sent to the backend. */
export interface BookReferencePayload {
  book_id: string;
  page_ids: string[];
}

/**
 * Convert selected book references to the backend wire format.
 *
 * @param refs - Selected book references to convert.
 * @returns Array of book-id / page-ids payloads, filtering out empties.
 */
export function selectedBooksToPayload(
  refs: SelectedBookReference[],
): BookReferencePayload[] {
  return refs
    .map((ref) => ({
      book_id: ref.bookId,
      page_ids: Array.from(
        new Set(ref.pages.map((page) => page.pageId)),
      ).filter(Boolean),
    }))
    .filter((ref) => ref.book_id && ref.page_ids.length > 0);
}

/**
 * Count the total number of selected pages across all book references.
 *
 * @param refs - Selected book references.
 * @returns Total page count.
 */
export function countSelectedBookPages(refs: SelectedBookReference[]): number {
  return refs.reduce((total, ref) => total + ref.pages.length, 0);
}

/**
 * Normalize an unknown value into a list of valid book reference payloads.
 *
 * @param value - Raw value to normalize (typically from persisted state).
 * @returns Array of valid book-id / page-ids payloads.
 */
export function normalizeBookReferences(
  value: unknown,
): BookReferencePayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record: Record<string, unknown> =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const bookId = typeof record.book_id === "string" ? record.book_id : "";
      const pageIds = Array.isArray(record.page_ids)
        ? record.page_ids.filter(
            (pageId): pageId is string =>
              typeof pageId === "string" && !!pageId,
          )
        : [];
      return bookId && pageIds.length
        ? { book_id: bookId, page_ids: Array.from(new Set(pageIds)) }
        : null;
    })
    .filter((item): item is BookReferencePayload => item !== null);
}
