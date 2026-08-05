import { apiFetch, apiUrl } from "@/lib/api";

// ── Real notebook system (file-backed under data/user/workspace/notebook) ──
//
// Notebooks created in the Knowledge → Notebooks tab and consumed everywhere
// chat output is saved (SaveToNotebookModal) or referenced
// (NotebookRecordPicker) live in this system. They are distinct from the
// "Question Notebook" categories below which only track quiz entries.

/** Kind of record stored in a notebook (solve, question, research, etc.). */
export type NotebookRecordType =
  | "solve"
  | "question"
  | "research"
  | "chat"
  | "co_writer"
  | "tutorbot";

/** Lightweight notebook metadata returned by the list endpoint. */
export interface NotebookSummary {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  record_count?: number;
  created_at?: number;
  updated_at?: number;
}

/** A single record (saved output) inside a notebook. */
export interface NotebookRecordItem {
  id: string;
  type: NotebookRecordType | string;
  title: string;
  summary?: string;
  user_query: string;
  output: string;
  metadata?: Record<string, unknown>;
  created_at?: number;
  kb_name?: string | null;
}

/** Full notebook detail including all records. */
export interface NotebookDetail extends NotebookSummary {
  records: NotebookRecordItem[];
}

/** Fetch all notebooks for the current user.
 * @returns Array of notebook summaries (empty if none). */
export async function listNotebooks(): Promise<NotebookSummary[]> {
  const response = await apiFetch(apiUrl("/api/v1/notebook/list"), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const data = (await response.json()) as { notebooks: NotebookSummary[] };
  return data.notebooks ?? [];
}

/** Fetch a single notebook with all its records.
 * @param notebookId - The notebook's id.
 * @returns The notebook detail including records. */
export async function getNotebook(notebookId: string): Promise<NotebookDetail> {
  const response = await apiFetch(apiUrl(`/api/v1/notebook/${notebookId}`), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as NotebookDetail;
}

/** Create a new notebook.
 * @param payload - Name, optional description, color, and icon.
 * @returns The created notebook summary. */
export async function createNotebook(payload: {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}): Promise<NotebookSummary> {
  const response = await apiFetch(apiUrl("/api/v1/notebook/create"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? "",
      color: payload.color ?? "#6366F1",
      icon: payload.icon ?? "book",
    }),
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const data = (await response.json()) as { notebook: NotebookSummary };
  return data.notebook;
}

/** Update a notebook's metadata (name, description, color, icon).
 * @param notebookId - The notebook's id.
 * @param payload - Fields to update.
 * @returns The updated notebook summary. */
export async function updateNotebook(
  notebookId: string,
  payload: {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
  },
): Promise<NotebookSummary> {
  const response = await apiFetch(apiUrl(`/api/v1/notebook/${notebookId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const data = (await response.json()) as { notebook: NotebookSummary };
  return data.notebook;
}

/** Delete an entire notebook and all its records.
 * @param notebookId - The notebook's id. */
export async function deleteNotebook(notebookId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/v1/notebook/${notebookId}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

/** Delete a single record from a notebook.
 * @param notebookId - The notebook's id.
 * @param recordId - The record's id. */
export async function deleteNotebookRecord(
  notebookId: string,
  recordId: string,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/notebook/${notebookId}/records/${recordId}`),
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

// ── Question notebook (quiz entries + categories) ─────────────────

/** Image attached to a notebook answer entry. */
export interface NotebookAnswerImage {
  id: string;
  url: string;
  filename: string;
  mime_type: string;
}

/** A quiz question entry saved to the question notebook. */
export interface NotebookEntry {
  id: number;
  session_id: string;
  session_title: string;
  turn_id: string;
  question_id: string;
  question: string;
  question_type: string;
  options: Record<string, string>;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  user_answer: string;
  user_answer_images?: NotebookAnswerImage[];
  is_correct: boolean;
  bookmarked: boolean;
  followup_session_id: string;
  /** Latest AI-judge text for this entry; empty when never run. */
  ai_judgment?: string;
  created_at: number;
  updated_at: number;
  categories?: NotebookCategory[];
}

/** A user-created category for organizing notebook entries. */
export interface NotebookCategory {
  id: number;
  name: string;
  created_at: number;
  entry_count: number;
}

/** Paginated response from the notebook entries list endpoint. */
export interface NotebookEntryListResponse {
  items: NotebookEntry[];
  total: number;
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// ── Entries ──────────────────────────────────────────────────────

/** List question-notebook entries with optional filtering and pagination.
 * @param filter - Optional category, bookmarked, correctness, and limit/offset filters.
 * @returns Paginated list of notebook entries. */
export async function listNotebookEntries(
  filter: {
    category_id?: number;
    bookmarked?: boolean;
    is_correct?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<NotebookEntryListResponse> {
  const params = new URLSearchParams();
  if (filter.category_id !== undefined)
    params.set("category_id", String(filter.category_id));
  if (filter.bookmarked !== undefined)
    params.set("bookmarked", String(filter.bookmarked));
  if (filter.is_correct !== undefined)
    params.set("is_correct", String(filter.is_correct));
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.offset !== undefined) params.set("offset", String(filter.offset));
  const query = params.toString();
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/entries${query ? `?${query}` : ""}`),
    { cache: "no-store" },
  );
  return expectJson<NotebookEntryListResponse>(response);
}

/** Fetch a single notebook entry by id.
 * @param entryId - The entry's numeric id.
 * @returns The notebook entry. */
export async function getNotebookEntry(
  entryId: number,
): Promise<NotebookEntry> {
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/entries/${entryId}`),
    {
      cache: "no-store",
    },
  );
  return expectJson<NotebookEntry>(response);
}

/** Look up a notebook entry by session and question id.
 * @param sessionId - The chat session id.
 * @param questionId - The question id within the session.
 * @param turnId - Optional turn id to disambiguate.
 * @returns The matching entry, or null if none exists yet. */
export async function lookupNotebookEntry(
  sessionId: string,
  questionId: string,
  turnId?: string | null,
): Promise<NotebookEntry | null> {
  const params = new URLSearchParams({
    session_id: sessionId,
    question_id: questionId,
    // Probe quietly: a not-yet-saved question returns 204 instead of 404, so
    // it stays out of the server error log and the browser network console.
    missing_ok: "true",
  });
  if (turnId) params.set("turn_id", turnId);
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/entries/lookup/by-question?${params}`),
  );
  // 204 (missing_ok hit) and 404 (older servers) both mean "no entry yet".
  if (response.status === 204 || response.status === 404) return null;
  return expectJson<NotebookEntry>(response);
}

/** Patch a notebook entry (bookmark, follow-up session, AI judgment).
 * @param entryId - The entry's numeric id.
 * @param updates - Fields to update. */
export async function updateNotebookEntry(
  entryId: number,
  updates: {
    bookmarked?: boolean;
    followup_session_id?: string;
    ai_judgment?: string;
  },
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/entries/${entryId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    },
  );
  await expectJson<{ updated: boolean }>(response);
}

/** Upload shape for a notebook answer image (base64 or existing URL). */
export interface NotebookAnswerImageUpload {
  id?: string;
  /** Base64 (no ``data:`` prefix) for a freshly-picked image. */
  base64?: string;
  /** Existing AttachmentStore URL for an already-persisted image. */
  url?: string;
  filename: string;
  mime_type: string;
}

/** Create or update a notebook entry (upsert by session/turn/question).
 * @param data - Entry fields including session, question, and answer details.
 * @returns The upserted notebook entry. */
export async function upsertNotebookEntry(data: {
  session_id: string;
  turn_id?: string;
  question_id: string;
  question: string;
  question_type?: string;
  options?: Record<string, string>;
  correct_answer?: string;
  explanation?: string;
  difficulty?: string;
  user_answer?: string;
  /**
   * Optional list of images attached to the learner's answer. Omit to
   * leave any stored images untouched; pass an empty array to clear them.
   */
  user_answer_images?: NotebookAnswerImageUpload[];
  is_correct?: boolean;
}): Promise<NotebookEntry> {
  const response = await apiFetch(
    apiUrl("/api/v1/question-notebook/entries/upsert"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        options: data.options || {},
        explanation: data.explanation || "",
        difficulty: data.difficulty || "",
      }),
    },
  );
  return expectJson<NotebookEntry>(response);
}

/** Delete a notebook entry by id.
 * @param entryId - The entry's numeric id. */
export async function deleteNotebookEntry(entryId: number): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/entries/${entryId}`),
    {
      method: "DELETE",
    },
  );
  await expectJson<{ deleted: boolean }>(response);
}

// ── Entry ↔ Category ────────────────────────────────────────────

/** Add a notebook entry to a category.
 * @param entryId - The entry's numeric id.
 * @param categoryId - The category's numeric id. */
export async function addEntryToCategory(
  entryId: number,
  categoryId: number,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/entries/${entryId}/categories`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: categoryId }),
    },
  );
  await expectJson<{ added: boolean }>(response);
}

/** Remove a notebook entry from a category.
 * @param entryId - The entry's numeric id.
 * @param categoryId - The category's numeric id. */
export async function removeEntryFromCategory(
  entryId: number,
  categoryId: number,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(
      `/api/v1/question-notebook/entries/${entryId}/categories/${categoryId}`,
    ),
    { method: "DELETE" },
  );
  await expectJson<{ removed: boolean }>(response);
}

// ── Categories ──────────────────────────────────────────────────

/** List all question-notebook categories.
 * @returns Array of categories with entry counts. */
export async function listCategories(): Promise<NotebookCategory[]> {
  const response = await apiFetch(
    apiUrl("/api/v1/question-notebook/categories"),
    {
      cache: "no-store",
    },
  );
  return expectJson<NotebookCategory[]>(response);
}

/** Create a new question-notebook category.
 * @param name - The category name.
 * @returns The created category. */
export async function createCategory(name: string): Promise<NotebookCategory> {
  const response = await apiFetch(
    apiUrl("/api/v1/question-notebook/categories"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  return expectJson<NotebookCategory>(response);
}

/** Rename an existing category.
 * @param categoryId - The category's numeric id.
 * @param name - The new name. */
export async function renameCategory(
  categoryId: number,
  name: string,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/categories/${categoryId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  await expectJson<{ updated: boolean }>(response);
}

/** Delete a category by id.
 * @param categoryId - The category's numeric id. */
export async function deleteCategory(categoryId: number): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/question-notebook/categories/${categoryId}`),
    {
      method: "DELETE",
    },
  );
  await expectJson<{ deleted: boolean }>(response);
}
