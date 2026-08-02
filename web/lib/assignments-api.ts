import { apiFetch, apiUrl } from "@/lib/api";

export type QuestionType =
  | "choice"
  | "concept"
  | "fill_in_blank"
  | "short_answer"
  | "written"
  | "coding";

export const AUTO_GRADABLE_TYPES: QuestionType[] = ["choice", "concept", "fill_in_blank"];
export const FREE_TEXT_TYPES: QuestionType[] = ["short_answer", "written", "coding"];

/** Full question shape — instructor/admin view only (includes the answer key). */
export interface Question {
  question_id: string;
  question: string;
  question_type: QuestionType;
  options: Record<string, string> | null;
  correct_answer: string;
  explanation: string;
  points: number;
}

/** What a student sees before submitting — no answer key. */
export interface PublicQuestion {
  question_id: string;
  question: string;
  question_type: QuestionType;
  options: Record<string, string> | null;
  points: number;
}

export interface QuestionResult {
  question_id: string;
  question: string;
  user_answer: string;
  is_correct: boolean;
  score: number;
  max_score: number;
  feedback: string;
}

export interface Submission {
  id: string;
  assignment_id: string;
  user_id: string;
  answers: { question_id: string; answer: string }[];
  question_results: QuestionResult[];
  score: number;
  max_score: number;
  submitted_at: string;
}

export interface SubmissionWithStudent extends Submission {
  username: string;
  full_name: string;
  registration_number: string;
}

export interface AssignmentSummary {
  id: string;
  course_unit_id: string;
  title: string;
  description: string;
  status: "draft" | "published";
  weight: number;
  attempt_limit: number;
  due_at: string;
  is_timed: boolean;
  time_limit_minutes: number | null;
  question_count: number;
  created_at: string;
}

/** Full assignment — returned to admins/instructors that manage it. */
export interface Assignment extends AssignmentSummary {
  questions: Question[];
  created_by: string;
}

/** Returned to a student: questions have no answer key, plus their own attempt state. */
export interface StudentAssignmentView extends AssignmentSummary {
  questions: PublicQuestion[];
  my_attempts: number;
  my_latest_submission: Submission | null;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? fallback);
  }
  return res.json() as Promise<T>;
}

export interface AssignmentDraft {
  title: string;
  description?: string;
  questions?: Omit<Question, "question_id">[];
  weight?: number;
  attempt_limit?: number;
  due_at?: string;
  is_timed?: boolean;
  time_limit_minutes?: number | null;
}

export async function createAssignment(
  courseUnitId: string,
  draft: AssignmentDraft,
): Promise<Assignment> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/assignments`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  );
  const data = await unwrap<{ assignment: Assignment }>(res, "Failed to create assignment");
  return data.assignment;
}

export async function listAssignments(courseUnitId: string): Promise<AssignmentSummary[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/assignments`),
  );
  const data = await unwrap<{ assignments: AssignmentSummary[] }>(
    res,
    "Failed to load assignments",
  );
  return data.assignments;
}

/** Returns the instructor/admin full view or the student-stripped view,
 * depending on the caller's relationship to the course unit — the server
 * decides which shape to send back. */
export async function getAssignment(
  assignmentId: string,
): Promise<Assignment | StudentAssignmentView> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}`),
  );
  const data = await unwrap<{ assignment: Assignment | StudentAssignmentView }>(
    res,
    "Failed to load assignment",
  );
  return data.assignment;
}

export async function updateAssignment(
  assignmentId: string,
  updates: Partial<AssignmentDraft>,
): Promise<Assignment> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    },
  );
  const data = await unwrap<{ assignment: Assignment }>(res, "Failed to update assignment");
  return data.assignment;
}

export async function publishAssignment(assignmentId: string): Promise<Assignment> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/publish`),
    { method: "POST" },
  );
  const data = await unwrap<{ assignment: Assignment }>(res, "Failed to publish assignment");
  return data.assignment;
}

export async function unpublishAssignment(assignmentId: string): Promise<Assignment> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/unpublish`),
    { method: "POST" },
  );
  const data = await unwrap<{ assignment: Assignment }>(res, "Failed to unpublish assignment");
  return data.assignment;
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}`),
    { method: "DELETE" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to delete assignment");
}

export async function submitAssignment(
  assignmentId: string,
  answers: { question_id: string; answer: string }[],
): Promise<Submission> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/submit`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  );
  const data = await unwrap<{ submission: Submission }>(res, "Failed to submit assignment");
  return data.submission;
}

export async function listSubmissions(
  assignmentId: string,
): Promise<SubmissionWithStudent[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/submissions`),
  );
  const data = await unwrap<{ submissions: SubmissionWithStudent[] }>(
    res,
    "Failed to load submissions",
  );
  return data.submissions;
}

export async function getMySubmission(assignmentId: string): Promise<Submission | null> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/my-submission`),
  );
  const data = await unwrap<{ submission: Submission | null }>(
    res,
    "Failed to load your submission",
  );
  return data.submission;
}

// ---------------------------------------------------------------------------
// Access grants (A3) — per-student exception/emergency access
// ---------------------------------------------------------------------------

export interface AccessGrant {
  id: string;
  assignment_id: string;
  user_id: string;
  extra_attempts: number | null;
  extended_due_at: string | null;
  granted_by: string;
  granted_at: string;
}

export async function listAccessGrants(assignmentId: string): Promise<AccessGrant[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/access-grants`),
  );
  const data = await unwrap<{ grants: AccessGrant[] }>(res, "Failed to load access grants");
  return data.grants;
}

export async function createAccessGrant(
  assignmentId: string,
  payload: { user_id: string; extra_attempts?: number | null; extended_due_at?: string | null },
): Promise<AccessGrant> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/access-grants`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = await unwrap<{ grant: AccessGrant }>(res, "Failed to create access grant");
  return data.grant;
}

export async function revokeAccessGrant(
  assignmentId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/assignments/${encodeURIComponent(assignmentId)}/access-grants/${encodeURIComponent(userId)}`,
    ),
    { method: "DELETE" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to revoke access grant");
}
