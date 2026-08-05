import { apiUrl, apiFetch } from "./api";

/** Payload for initializing learning modules on a book's progress. */
export interface ModuleInit {
  id: string;
  name: string;
  order: number;
  pass_threshold?: number;
  knowledge_points: {
    id: string;
    name: string;
    type: string;
    module_id: string;
  }[];
}

/** A knowledge point within a learning module. */
export interface LearningKnowledgePoint {
  id: string;
  name: string;
  type: string;
}

/** A learning module containing knowledge points and a pass threshold. */
export interface LearningModule {
  id: string;
  name: string;
  order: number;
  pass_threshold: number;
  knowledge_points: LearningKnowledgePoint[];
}

/** Detailed progress for a book, including modules and mastery levels. */
export interface ProgressDetail {
  book_id: string;
  modules: LearningModule[];
  mastery_levels: Record<string, number>;
  current_module_id?: string;
  current_stage?: string;
  diagnostic?: unknown;
}

/**
 * Fetch the learning progress detail for a book.
 *
 * @param bookId - ID of the book.
 * @returns Progress detail with modules and mastery levels.
 */
export async function fetchProgress(bookId: string): Promise<ProgressDetail> {
  const res = await apiFetch(apiUrl(`/api/v1/learning/progress/${bookId}`));
  if (!res.ok) throw new Error(`Failed to fetch progress: ${res.status}`);
  return res.json() as Promise<ProgressDetail>;
}

/**
 * Initialize learning modules for a book's progress.
 *
 * @param bookId - ID of the book.
 * @param modules - Module initialization payloads.
 */
export async function initModules(bookId: string, modules: ModuleInit[]) {
  const res = await apiFetch(
    apiUrl(`/api/v1/learning/progress/${bookId}/init-modules`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules }),
    },
  );
  if (!res.ok) throw new Error(`Failed to init modules: ${res.status}`);
  return res.json();
}

// ── Mastery map (the dashboard view) ──────────────────────────────────────
// Mirrors deeptutor/learning/policy.py map_summary + next_objective.

/** Mastery status of a knowledge point in the mastery map. */
export type ObjectiveStatus = "new" | "learning" | "mastered";

/** A knowledge point in the mastery map dashboard view. */
export interface MapKnowledgePoint {
  id: string;
  name: string;
  type: string;
  status: ObjectiveStatus;
  mastery: number;
}

/** A module in the mastery map with per-knowledge-point mastery. */
export interface MapModule {
  id: string;
  name: string;
  order: number;
  mastered: number;
  total: number;
  knowledge_points: MapKnowledgePoint[];
}

/** The mastery map dashboard — counts, due reviews, and per-module breakdown. */
export interface MasteryMap {
  counts: { mastered: number; learning: number; new: number; total: number };
  due_reviews: number;
  complete: boolean;
  modules: MapModule[];
}

/** The next recommended learning step for the user. */
export interface NextStep {
  action: string;
  knowledge_point_name: string;
  knowledge_point_type: string;
  status: string;
  mastery: number;
  threshold: number;
  reason: string;
}

/** Result of fetching the mastery map — the map and the next step. */
export interface MasteryMapResult {
  book_id: string;
  next: NextStep;
  map: MasteryMap;
}

/**
 * Fetch the mastery map and next step for a learning path.
 *
 * @param pathId - ID of the learning path (book ID).
 * @returns The mastery map result with next step and map.
 */
export async function fetchMasteryMap(
  pathId: string,
): Promise<MasteryMapResult> {
  const res = await apiFetch(
    apiUrl(`/api/v1/learning/progress/${encodeURIComponent(pathId)}/map`),
  );
  if (!res.ok) throw new Error(`Failed to fetch mastery map: ${res.status}`);
  return res.json() as Promise<MasteryMapResult>;
}

/** Summary of a single book's learning progress. */
export interface ProgressSummary {
  book_id: string;
  name: string;
  modules_count: number;
  kp_count: number;
  current_stage: string;
  avg_mastery_pct: number;
  updated_at: number;
}

/** Result of fetching all progress summaries — summaries and per-book errors. */
export interface ProgressListResult {
  summaries: ProgressSummary[];
  errors: { book_id: string; error: string }[];
}

/**
 * Fetch progress summaries for all books.
 *
 * @returns Progress summaries and any per-book errors.
 */
export async function fetchAllProgress(): Promise<ProgressListResult> {
  const res = await apiFetch(apiUrl("/api/v1/learning/progress"));
  if (!res.ok) throw new Error(`Failed to fetch all progress: ${res.status}`);
  return res.json();
}

/**
 * Delete a book's learning progress.
 *
 * @param bookId - ID of the book whose progress to delete.
 */
export async function deleteProgress(bookId: string) {
  const res = await apiFetch(
    apiUrl(`/api/v1/learning/progress/${encodeURIComponent(bookId)}`),
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Failed to delete progress: ${res.status}`);
  return res.json();
}

/**
 * Reset a book's learning progress to the initial diagnostic state.
 *
 * @param bookId - ID of the book whose progress to redo.
 */
export async function redoProgress(bookId: string) {
  const res = await apiFetch(
    apiUrl(`/api/v1/learning/progress/${encodeURIComponent(bookId)}/redo`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Failed to redo progress: ${res.status}`);
  return res.json();
}

/**
 * Import learning modules from a book's chapter structure.
 *
 * @param bookId - ID of the book.
 * @param chapters - Chapters with their knowledge point names.
 */
export async function importFromBook(
  bookId: string,
  chapters: { title: string; knowledge_points: string[] }[],
) {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/learning/progress/${encodeURIComponent(bookId)}/import-from-book`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapters }),
    },
  );
  if (!res.ok) throw new Error(`Failed to import from book: ${res.status}`);
  return res.json();
}

/**
 * Generate learning modules from notebook records.
 *
 * @param bookId - ID of the book.
 * @param notebookId - ID of the source notebook.
 * @param records - Notebook cell records to derive modules from.
 * @returns Generated module initialization payloads.
 */
export async function generateModulesFromNotebook(
  bookId: string,
  notebookId: string,
  records: { id: string; type: string; title: string; output: string }[],
): Promise<{ modules: ModuleInit[] }> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/learning/progress/${encodeURIComponent(bookId)}/generate-from-notebook`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebook_id: notebookId, records }),
    },
  );
  if (!res.ok)
    throw new Error(`Failed to generate modules from notebook: ${res.status}`);
  return res.json();
}
