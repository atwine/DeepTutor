import { apiFetch, apiUrl } from "@/lib/api";

const BASE = "/api/v1/co_writer";

/** Summary of a Co-Writer document for list views. */
export interface CoWriterDocumentSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  preview: string;
}

/** Full Co-Writer document with content. */
export interface CoWriterDocument {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Request failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * List all Co-Writer documents for the current user.
 *
 * @returns Array of document summaries.
 */
export async function listCoWriterDocuments(): Promise<
  CoWriterDocumentSummary[]
> {
  const res = await apiFetch(apiUrl(`${BASE}/documents`), {
    cache: "no-store",
  });
  const data = await jsonOrThrow<{ documents: CoWriterDocumentSummary[] }>(res);
  return Array.isArray(data?.documents) ? data.documents : [];
}

/**
 * Create a new Co-Writer document.
 *
 * @param payload - Optional title and initial content.
 * @returns The created document.
 */
export async function createCoWriterDocument(payload?: {
  title?: string;
  content?: string;
}): Promise<CoWriterDocument> {
  const res = await apiFetch(apiUrl(`${BASE}/documents`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: payload?.title ?? null,
      content: payload?.content ?? "",
    }),
  });
  return jsonOrThrow<CoWriterDocument>(res);
}

/**
 * Fetch a single Co-Writer document by ID.
 *
 * @param docId - ID of the document to retrieve.
 * @returns The full document.
 */
export async function getCoWriterDocument(
  docId: string,
): Promise<CoWriterDocument> {
  const res = await apiFetch(
    apiUrl(`${BASE}/documents/${encodeURIComponent(docId)}`),
    {
      cache: "no-store",
    },
  );
  return jsonOrThrow<CoWriterDocument>(res);
}

/**
 * Update a Co-Writer document's title and/or content.
 *
 * @param docId - ID of the document to update.
 * @param payload - Fields to update (title and/or content).
 * @returns The updated document.
 */
export async function updateCoWriterDocument(
  docId: string,
  payload: { title?: string | null; content?: string | null },
): Promise<CoWriterDocument> {
  const res = await apiFetch(
    apiUrl(`${BASE}/documents/${encodeURIComponent(docId)}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title ?? null,
        content: payload.content ?? null,
      }),
    },
  );
  return jsonOrThrow<CoWriterDocument>(res);
}

/**
 * Delete a Co-Writer document.
 *
 * @param docId - ID of the document to delete.
 * @returns True if the document was deleted.
 */
export async function deleteCoWriterDocument(docId: string): Promise<boolean> {
  const res = await apiFetch(
    apiUrl(`${BASE}/documents/${encodeURIComponent(docId)}`),
    {
      method: "DELETE",
    },
  );
  const data = await jsonOrThrow<{ deleted: boolean }>(res);
  return Boolean(data?.deleted);
}
