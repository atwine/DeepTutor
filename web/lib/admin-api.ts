import { apiFetch, apiUrl } from "@/lib/api";

export type UserRole = "admin" | "instructor" | "user";

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

export async function listUsers(): Promise<UserRecord[]> {
  const res = await apiFetch(apiUrl("/api/v1/auth/users"));
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

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

export interface CreatedUser {
  user_id: string;
  username: string;
  role: UserRole;
  is_admin: boolean;
}

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

export interface StudentsOverviewResponse {
  stats: StudentOverviewStats;
  course_options: string[];
  students: StudentOverviewRow[];
}

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
