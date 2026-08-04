import { apiFetch, apiUrl } from "@/lib/api";
import { invalidateClientCache, withClientCache } from "@/lib/client-cache";
import type { LLMSelection, StreamEvent } from "@/lib/unified-ws";

/** Thumbs up/down rating and optional comment for a message. */
export interface MessageFeedback {
  rating: "up" | "down" | null;
  comment: string;
  updated_at: number;
}

/** A single persisted message in a chat session. */
export interface SessionMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  capability?: string;
  events: StreamEvent[];
  attachments: Array<{
    type: string;
    filename?: string;
    base64?: string;
    url?: string;
    mime_type?: string;
    id?: string;
    extracted_text?: string;
    generated?: boolean;
    size_bytes?: number;
  }>;
  metadata?: Record<string, unknown>;
  /** Thumbs up/down (+ optional comment) — assistant messages only. */
  feedback?: MessageFeedback | null;
  created_at: number;
  /** Edit-branching: id of the message this row continues. `null` for the
   *  first message in a session. Siblings share the same parent. */
  parent_message_id?: number | null;
}

/** Lightweight session metadata for list views. */
export interface SessionSummary {
  id: string;
  session_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_message: string;
  status?:
    | "idle"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "rejected";
  active_turn_id?: string;
  preferences?: {
    capability?: string;
    tools?: string[];
    knowledge_bases?: string[];
    language?: string;
    llm_selection?: LLMSelection | null;
    /** Session-level persona preference; "" / absent = Default (no persona). */
    persona?: string;
    /** Edit-branching: maps a parent_message_id → the child id currently
     *  shown at that branch point. Missing keys default to the latest
     *  sibling (most recently created child). */
    selected_branches?: Record<string, number>;
  };
}

/** Summary of an active (in-flight) turn. */
export interface ActiveTurnSummary {
  id: string;
  turn_id: string;
  session_id: string;
  capability: string;
  status: "running" | "completed" | "failed" | "cancelled" | "rejected";
  error: string;
  created_at: number;
  updated_at: number;
  finished_at?: number | null;
  last_seq: number;
}

/** Full session detail including all messages and active turns. */
export interface SessionDetail {
  id: string;
  session_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  status?:
    | "idle"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "rejected";
  active_turn_id?: string;
  compressed_summary?: string;
  summary_up_to_msg_id?: number;
  preferences?: {
    capability?: string;
    tools?: string[];
    knowledge_bases?: string[];
    language?: string;
    llm_selection?: LLMSelection | null;
    /** Session-level persona preference; "" / absent = Default (no persona). */
    persona?: string;
    /** Edit-branching: maps a parent_message_id → the child id currently
     *  shown at that branch point. Missing keys default to the latest
     *  sibling (most recently created child). */
    selected_branches?: Record<string, number>;
  };
  messages: SessionMessage[];
  active_turns?: ActiveTurnSummary[];
}

/** A single quiz answer result for recording. */
export interface QuizResultItem {
  question_id?: string;
  question: string;
  question_type?: string;
  options?: Record<string, string>;
  user_answer: string;
  correct_answer: string;
  explanation?: string;
  difficulty?: string;
  is_correct: boolean;
}

async function expectJson<T>(response: Response): Promise<T> {
  if (response.status === 401 && typeof window !== "undefined") {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
    return new Promise(() => {});
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data) => (typeof data?.detail === "string" ? data.detail : null))
      .catch(() => null);
    throw new Error(detail ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** List chat sessions with pagination (client-cached, 15s TTL).
 * @param limit - Max sessions to return (default 50).
 * @param offset - Pagination offset (default 0).
 * @param options - Pass `force` to bypass the cache.
 * @returns Array of session summaries. */
export async function listSessions(
  limit = 50,
  offset = 0,
  options?: { force?: boolean },
): Promise<SessionSummary[]> {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return withClientCache<SessionSummary[]>(
    `sessions:${limit}:${offset}`,
    async () => {
      const response = await apiFetch(
        apiUrl(`/api/v1/sessions?${qs.toString()}`),
        {
          cache: "no-store",
        },
      );
      const data = await expectJson<{ sessions: SessionSummary[] }>(response);
      return data.sessions ?? [];
    },
    {
      force: options?.force,
      ttlMs: 15_000,
    },
  );
}

/** Fetch a single session with all messages and active turns.
 * @param sessionId - The session id.
 * @param signal - Optional AbortSignal to cancel the request.
 * @returns The full session detail. */
export async function getSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDetail> {
  const response = await apiFetch(apiUrl(`/api/v1/sessions/${sessionId}`), {
    cache: "no-store",
    signal,
  });
  return expectJson<SessionDetail>(response);
}

/** Rename a session and invalidate the session list cache.
 * @param sessionId - The session id.
 * @param title - The new title.
 * @returns The updated session detail. */
export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<SessionDetail> {
  const response = await apiFetch(apiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await expectJson<{ session: SessionDetail }>(response);
  invalidateClientCache("sessions:");
  return data.session;
}

/** Delete a session and invalidate the session list cache.
 * @param sessionId - The session id. */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "DELETE",
  });
  await expectJson<{ deleted: boolean }>(response);
  invalidateClientCache("sessions:");
}

/** Set thumbs up/down feedback (and optional comment) on a message.
 * @param sessionId - The session id.
 * @param messageId - The message id.
 * @param rating - "up", "down", or null to clear.
 * @param comment - Optional feedback comment.
 * @returns The stored feedback object. */
export async function setMessageFeedback(
  sessionId: string,
  messageId: number,
  rating: "up" | "down" | null,
  comment: string = "",
): Promise<MessageFeedback> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment }),
    },
  );
  const data = await expectJson<{ feedback: MessageFeedback }>(response);
  return data.feedback;
}

/** A feedback entry with its paired question and session context. */
export interface FeedbackEntry {
  message_id: number;
  session_id: string;
  session_title: string;
  content: string;
  /** The paired user question this response answered, snapshotted at rating time. */
  question: string;
  capability: string;
  rating: "up" | "down" | null;
  comment: string;
  updated_at: number;
  created_at: number;
}

/** List all message feedback (admin endpoint).
 * @param limit - Max entries to return (default 200).
 * @returns Array of feedback entries. */
export async function listMessageFeedback(limit = 200): Promise<FeedbackEntry[]> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/admin/feedback?limit=${limit}`),
  );
  const data = await expectJson<{ feedback: FeedbackEntry[] }>(response);
  return data.feedback;
}

/** Record quiz answer results for a session.
 * @param sessionId - The session id.
 * @param answers - Array of quiz answer items.
 * @param turnId - Optional turn id for the quiz generation turn. */
export async function recordQuizResults(
  sessionId: string,
  answers: QuizResultItem[],
  turnId?: string | null,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/quiz-results`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, turn_id: turnId || "" }),
    },
  );
  await expectJson<{ recorded: boolean }>(response);
}

/** Delete a single message from a session.
 * @param sessionId - The session id.
 * @param messageId - The message id. */
export async function deleteMessage(
  sessionId: string,
  messageId: number,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/messages/${messageId}`),
    { method: "DELETE" },
  );
  await expectJson<{ deleted: boolean }>(response);
}

/** Persist the selected branch at each edit-branching point.
 * @param sessionId - The session id.
 * @param selectedBranches - Map of parentMessageId → selected child id. */
export async function updateBranchSelection(
  sessionId: string,
  selectedBranches: Record<string, number>,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/branch-selection`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_branches: selectedBranches }),
    },
  );
  await expectJson<{ selected_branches: Record<string, number> }>(response);
}
