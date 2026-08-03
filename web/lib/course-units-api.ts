import { apiFetch, apiUrl } from "@/lib/api";

export interface CourseUnit {
  id: string;
  name: string;
  term: string;
  description: string;
  instructor_ids: string[];
  /** Server-resolved usernames for `instructor_ids`, same order — lets a
   * non-admin instructor see a co-instructor's name without needing the
   * admin-only user list. */
  instructor_usernames: string[];
  /** B1: Course start/end dates (ISO date string "YYYY-MM-DD" or empty). */
  start_date: string;
  end_date: string;
  /** Round 3: archived course units block student access the same way an
   * expired (past grace period) course does, and are excluded from the
   * student join-catalog for anyone not already enrolled/pending on it. */
  is_archived: boolean;
  created_at: string;
}

/** A course unit as shown in the student-facing catalog: `my_status` is the
 * caller's own relationship to it. "teaching" means the caller is one of
 * the unit's instructors (shown instead of an enrollment status — an
 * instructor doesn't request to join their own course). */
export interface CatalogCourseUnit extends CourseUnit {
  my_status: "pending" | "approved" | "leave_requested" | "teaching" | null;
  /** Issue #4: ISO timestamp when the student completed the unit (all
   * published assignments submitted+graded), or "" when not yet completed.
   * Only populated for approved enrollments; "" otherwise. Completion is
   * automatic and never revokes read access to course materials. */
  completed_at: string;
}

export interface RosterEntry {
  user_id: string;
  username: string;
  role: string;
  full_name: string;
  registration_number: string;
  requested_at: string;
  approved_at: string;
}

export interface StudentSearchResult {
  id: string;
  username: string;
  full_name: string;
  registration_number: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? fallback);
  }
  return res.json() as Promise<T>;
}

/** Admins see every course unit; instructors see only the ones they teach. */
export async function listCourseUnits(): Promise<CourseUnit[]> {
  const res = await apiFetch(apiUrl("/api/v1/multi-user/course-units"));
  const data = await unwrap<{ course_units: CourseUnit[] }>(
    res,
    "Failed to fetch course units",
  );
  return data.course_units;
}

/** Any signed-in account's own view (admin: all, instructor: taught, student: enrolled). */
export async function listMyCourseUnits(): Promise<CourseUnit[]> {
  const res = await apiFetch(apiUrl("/api/v1/multi-user/my/course-units"));
  const data = await unwrap<{ course_units: CourseUnit[] }>(
    res,
    "Failed to fetch course units",
  );
  return data.course_units;
}

export async function createCourseUnit(
  name: string,
  term: string,
  instructorIds: string[],
  description: string = "",
  startDate: string = "",
  endDate: string = "",
): Promise<CourseUnit> {
  const res = await apiFetch(apiUrl("/api/v1/multi-user/course-units"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      term,
      description,
      instructor_ids: instructorIds,
      start_date: startDate,
      end_date: endDate,
    }),
  });
  const data = await unwrap<{ course_unit: CourseUnit }>(
    res,
    "Failed to create course unit",
  );
  return data.course_unit;
}

export async function updateCourseUnit(
  courseUnitId: string,
  updates: Partial<
    Pick<CourseUnit, "name" | "term" | "description" | "instructor_ids" | "start_date" | "end_date">
  >,
): Promise<CourseUnit> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    },
  );
  const data = await unwrap<{ course_unit: CourseUnit }>(
    res,
    "Failed to update course unit",
  );
  return data.course_unit;
}

export async function deleteCourseUnit(courseUnitId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}`),
    { method: "DELETE" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to delete course unit");
}

/** Round 3: archive a course unit — blocks students the same way an
 * expired course does, while instructor/admin access is unaffected. */
export async function archiveCourseUnit(courseUnitId: string): Promise<CourseUnit> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/archive`),
    { method: "POST" },
  );
  const data = await unwrap<{ course_unit: CourseUnit }>(
    res,
    "Failed to archive course unit",
  );
  return data.course_unit;
}

/** Round 3: reverse of `archiveCourseUnit`. */
export async function unarchiveCourseUnit(courseUnitId: string): Promise<CourseUnit> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/unarchive`),
    { method: "POST" },
  );
  const data = await unwrap<{ course_unit: CourseUnit }>(
    res,
    "Failed to unarchive course unit",
  );
  return data.course_unit;
}

export async function enrollStudent(
  courseUnitId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/enrollments`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    },
  );
  await unwrap<{ enrollment: unknown }>(res, "Failed to enroll student");
}

export async function unenrollStudent(
  courseUnitId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/enrollments/${encodeURIComponent(userId)}`,
    ),
    { method: "DELETE" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to unenroll student");
}

export async function getCourseUnitRoster(
  courseUnitId: string,
): Promise<RosterEntry[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/roster`),
  );
  const data = await unwrap<{ roster: RosterEntry[] }>(
    res,
    "Failed to fetch roster",
  );
  return data.roster;
}

/** Find student accounts by username, full name, or registration number. */
export async function searchStudents(
  query: string,
): Promise<StudentSearchResult[]> {
  if (!query.trim()) return [];
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/students/search?q=${encodeURIComponent(query)}`),
  );
  const data = await unwrap<{ students: StudentSearchResult[] }>(
    res,
    "Failed to search students",
  );
  return data.students;
}

/** Pending enrollment requests awaiting a decision for this course unit. */
export async function getCourseUnitRequests(
  courseUnitId: string,
): Promise<RosterEntry[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/requests`),
  );
  const data = await unwrap<{ requests: RosterEntry[] }>(
    res,
    "Failed to fetch requests",
  );
  return data.requests;
}

export async function approveEnrollmentRequest(
  courseUnitId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/requests/${encodeURIComponent(userId)}/approve`,
    ),
    { method: "POST" },
  );
  await unwrap<{ enrollment: unknown }>(res, "Failed to approve request");
}

export async function rejectEnrollmentRequest(
  courseUnitId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/requests/${encodeURIComponent(userId)}/reject`,
    ),
    { method: "POST" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to reject request");
}

/** Every course unit, annotated with the caller's own enrollment status —
 * the student-facing "what can I join" browse view. */
export async function getCourseCatalog(): Promise<CatalogCourseUnit[]> {
  const res = await apiFetch(apiUrl("/api/v1/multi-user/course-units/catalog"));
  const data = await unwrap<{ course_units: CatalogCourseUnit[] }>(
    res,
    "Failed to load course catalog",
  );
  return data.course_units;
}

/** Request enrollment in a course unit found via the catalog. */
export async function requestEnrollment(courseUnitId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/enrollment-requests`,
    ),
    { method: "POST" },
  );
  await unwrap<{ enrollment: unknown }>(res, "Failed to request enrollment");
}

// B2: Student-initiated leave/unenroll with instructor confirmation.

/** Student requests to leave (unenroll from) a course unit. */
export async function requestLeave(courseUnitId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/leave-requests`,
    ),
    { method: "POST" },
  );
  await unwrap<{ enrollment: unknown }>(res, "Failed to request leave");
}

/** Leave requests awaiting instructor confirmation for this course unit. */
export async function getLeaveRequests(
  courseUnitId: string,
): Promise<RosterEntry[]> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/leave-requests`,
    ),
  );
  const data = await unwrap<{ requests: RosterEntry[] }>(
    res,
    "Failed to fetch leave requests",
  );
  return data.requests;
}

/** Instructor confirms a leave request — removes the student from the roster. */
export async function approveLeaveRequest(
  courseUnitId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/leave-requests/${encodeURIComponent(userId)}/approve`,
    ),
    { method: "POST" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to approve leave request");
}

/** Instructor rejects a leave request — student stays enrolled. */
export async function rejectLeaveRequest(
  courseUnitId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/leave-requests/${encodeURIComponent(userId)}/reject`,
    ),
    { method: "POST" },
  );
  await unwrap<{ enrollment: unknown }>(res, "Failed to reject leave request");
}
