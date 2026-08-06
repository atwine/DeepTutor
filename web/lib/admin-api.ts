import { apiFetch, apiUrl } from "@/lib/api";

/** Role assigned to a user account within the multi-user system. */
export type UserRole = "admin" | "instructor" | "user";

/** A user account record as returned by the admin users API. */
export interface UserRecord {
  id: string;
  username: string;
  role: UserRole;
  created_at: string;
  disabled?: boolean;
  /** Avatar marker: "", "icon:<name>:<color>", or "img:<version>". */
  avatar?: string;
  full_name?: string;
  registration_number?: string;
  first_name?: string;
  surname?: string;
  gender?: string;
  course?: string;
}

/**
 * Fetch the list of all user accounts.
 *
 * @returns Array of user records.
 */
export async function listUsers(): Promise<UserRecord[]> {
  const res = await apiFetch(apiUrl("/api/v1/auth/users"));
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

/**
 * Delete a user account by username.
 *
 * @param username - Username of the account to delete.
 */
export async function deleteUser(username: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(username)}`),
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to delete user");
  }
}

/**
 * Set the role for a user account.
 *
 * @param username - Username of the account to update.
 * @param role - New role to assign.
 */
export async function setUserRole(
  username: string,
  role: UserRole,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(username)}/role`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to update role");
  }
}

/** Result returned after creating a new user account. */
export interface CreatedUser {
  user_id: string;
  username: string;
  role: UserRole;
  is_admin: boolean;
}

/**
 * Create a new user account.
 *
 * @param username - Username for the new account.
 * @param password - Password for the new account.
 * @returns The created user record.
 */
export async function createUser(
  username: string,
  password: string,
): Promise<CreatedUser> {
  const res = await apiFetch(apiUrl("/api/v1/auth/users"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail.length > 0 && detail[0]?.msg
          ? String(detail[0].msg)
          : "Failed to create user";
    throw new Error(message);
  }
  return (await res.json()) as CreatedUser;
}

/** Enable or disable a user account (admin-only). */
export async function setUserDisabled(
  username: string,
  disabled: boolean,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(username)}/disabled`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to update user status");
  }
}

// ---------------------------------------------------------------------------
// Issue #33: Admin student dashboard
// ---------------------------------------------------------------------------

/** Aggregate statistics for the admin student dashboard. */
export interface StudentOverviewStats {
  total_students: number;
  active_students: number;
  disabled_students: number;
  orphan_students: number;
  total_instructors: number;
  total_courses: number;
  total_enrollments: number;
  completion_rate: number;
}

/** A single student row in the admin dashboard overview. */
export interface StudentOverviewRow {
  id: string;
  username: string;
  full_name: string;
  first_name: string;
  surname: string;
  registration_number: string;
  gender: string;
  course: string;
  created_at: string;
  disabled: boolean;
  avatar: string;
  enrollment_count: number;
  course_names: string[];
  submission_count: number;
  completion_summary: { completed: number; total: number };
}

/** Response payload for the students overview endpoint. */
export interface StudentsOverviewResponse {
  stats: StudentOverviewStats;
  course_options: string[];
  students: StudentOverviewRow[];
}

/**
 * Fetch the admin student dashboard overview.
 *
 * @returns Aggregate stats and per-student rows.
 */
export async function getStudentsOverview(): Promise<StudentsOverviewResponse> {
  const res = await apiFetch(
    apiUrl("/api/v1/multi-user/admin/students/overview"),
  );
  if (!res.ok) throw new Error("Failed to fetch students overview");
  return res.json();
}

/** Issue #34: Instructor-scoped student overview — same response shape as
 * the admin endpoint but filtered to the calling instructor's courses. */
export async function getInstructorStudentsOverview(): Promise<StudentsOverviewResponse> {
  const res = await apiFetch(
    apiUrl("/api/v1/multi-user/instructor/students/overview"),
  );
  if (!res.ok) throw new Error("Failed to fetch students overview");
  return res.json();
}

/** A single labeled breakdown (e.g. gender, or masters/PhD) with counts and percentages. */
export interface InsightsBreakdown {
  counts: Record<string, number>;
  percentages: Record<string, number>;
  total: number;
}

/** One course's enrollment/completion numbers for the Insights page. */
export interface InsightsCourseRow {
  id: string;
  name: string;
  term: string;
  enrolled: number;
  completed: number;
  withdrawn: number;
  completion_rate: number;
}

/** Response payload for the admin Insights endpoint. */
export interface InsightsResponse {
  terms: string[];
  selected_term: string;
  stats: {
    total_students: number;
    total_courses: number;
    total_enrolled: number;
    total_completed: number;
    total_withdrawn: number;
    overall_completion_rate: number;
  };
  gender_breakdown: InsightsBreakdown;
  course_type_breakdown: InsightsBreakdown;
  per_course: InsightsCourseRow[];
}

/**
 * Fetch org-wide statistics for the admin Insights page — gender/course-type
 * breakdown and per-course completion rates. Pass a `term` (matches
 * CourseUnit.term, e.g. "2026 Semester 1") to scope to one term; omit for
 * every term combined.
 */
export async function getInsights(term?: string): Promise<InsightsResponse> {
  const query = term ? `?term=${encodeURIComponent(term)}` : "";
  const res = await apiFetch(apiUrl(`/api/v1/multi-user/admin/insights${query}`));
  if (!res.ok) throw new Error("Failed to fetch insights");
  return res.json();
}

/** Server-rendered CSV, cookie-authenticated — a plain navigation triggers
 * the download since auth here is a same-origin cookie, not a bearer token
 * the browser wouldn't otherwise send. Mirrors gradebookExportUrl's pattern. */
export function insightsExportUrl(term?: string): string {
  const query = term ? `?term=${encodeURIComponent(term)}` : "";
  return apiUrl(`/api/v1/multi-user/admin/insights/export${query}`);
}

/** Issue #35: Admin reset submission attempts — deletes all of a student's
 * submissions for one assignment so they can try again from scratch. */
export async function resetSubmissionAttempts(
  userId: string,
  assignmentId: string,
): Promise<{ deleted: number }> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/students/${encodeURIComponent(userId)}/submissions/${encodeURIComponent(assignmentId)}`,
    ),
    { method: "DELETE" },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to reset submission attempts");
  }
  return res.json();
}
