import { apiFetch, apiUrl } from "@/lib/api";

/** A course unit with its instructors, dates, and archive state. */
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

/** Issue #3: a file uploaded as course material for a course unit. */
export interface CourseMaterial {
  id: string;
  course_unit_id: string;
  filename: string;
  file_type: "ipynb" | "pdf" | "docx" | "pptx" | "xlsx" | "md" | "txt" | "other";
  size_bytes: number;
  status: "draft" | "published";
  uploaded_at: string;
  published_at: string | null;
  ingestion_status: "pending" | "indexing" | "ready" | "failed";
}

/** A single entry in a course unit's enrollment roster. */
export interface RosterEntry {
  user_id: string;
  username: string;
  role: string;
  full_name: string;
  registration_number: string;
  requested_at: string;
  approved_at: string;
}

/** A student account returned by the student search endpoint. */
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
  // 204 No Content (and any empty body) — return a default so callers
  // that expect JSON don't throw "Unexpected end of JSON input".
  if (res.status === 204) {
    return {} as T;
  }
  const text = await res.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
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

/** Issue #42: Paginated version — returns items + total count for pagination UI. */
export async function listCourseUnitsPaged(
  limit: number = 50,
  offset: number = 0,
): Promise<{ items: CourseUnit[]; total: number }> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units?limit=${limit}&offset=${offset}`,
    ),
  );
  const data = await unwrap<{ course_units: CourseUnit[]; total: number; limit: number; offset: number }>(
    res,
    "Failed to fetch course units",
  );
  return { items: data.course_units, total: data.total };
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

/**
 * Create a new course unit.
 *
 * @param name - Unit name.
 * @param term - Academic term (e.g. "Fall 2025").
 * @param instructorIds - User IDs of the instructors.
 * @param description - Optional description.
 * @param startDate - Optional start date (ISO "YYYY-MM-DD").
 * @param endDate - Optional end date (ISO "YYYY-MM-DD").
 * @returns The created course unit.
 */
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

/**
 * Update an existing course unit's editable fields.
 *
 * @param courseUnitId - ID of the course unit to update.
 * @param updates - Partial fields to change.
 * @returns The updated course unit.
 */
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

/**
 * Delete a course unit permanently.
 *
 * @param courseUnitId - ID of the course unit to delete.
 */
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

/**
 * Directly enroll a student in a course unit (instructor/admin).
 *
 * @param courseUnitId - ID of the course unit.
 * @param userId - ID of the student to enroll.
 */
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

/**
 * Remove a student from a course unit's roster.
 *
 * @param courseUnitId - ID of the course unit.
 * @param userId - ID of the student to unenroll.
 */
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

/**
 * Fetch the full roster for a course unit.
 *
 * @param courseUnitId - ID of the course unit.
 * @returns Array of roster entries.
 */
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

/** Issue #42: Paginated roster — returns items + total count. */
export async function getCourseUnitRosterPaged(
  courseUnitId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<{ items: RosterEntry[]; total: number }> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/roster?limit=${limit}&offset=${offset}`,
    ),
  );
  const data = await unwrap<{ roster: RosterEntry[]; total: number; limit: number; offset: number }>(
    res,
    "Failed to fetch roster",
  );
  return { items: data.roster, total: data.total };
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

/**
 * Approve a pending enrollment request.
 *
 * @param courseUnitId - ID of the course unit.
 * @param userId - ID of the student whose request to approve.
 */
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

/**
 * Reject a pending enrollment request.
 *
 * @param courseUnitId - ID of the course unit.
 * @param userId - ID of the student whose request to reject.
 */
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


// Issue #3: Course materials — instructor uploads + student-facing view.

/** Upload one or more files as course materials (instructor/admin only).
 * Uses multipart/form-data; the browser sets the boundary automatically. */
export async function uploadMaterials(
  courseUnitId: string,
  files: File[],
): Promise<CourseMaterial[]> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file, file.name);
  }
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/course-units/${encodeURIComponent(courseUnitId)}/materials/upload`,
    ),
    { method: "POST", body: form },
  );
  const data = await unwrap<{ materials: CourseMaterial[] }>(
    res,
    "Failed to upload materials",
  );
  return data.materials;
}

/** List materials for a course unit. Instructors/admins see all statuses;
 * students see only published materials (enforced server-side). */
export async function listMaterials(
  courseUnitId: string,
): Promise<CourseMaterial[]> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/course-units/${encodeURIComponent(courseUnitId)}/materials`,
    ),
  );
  const data = await unwrap<{ materials: CourseMaterial[] }>(
    res,
    "Failed to fetch materials",
  );
  return data.materials;
}

/** Publish a draft material so enrolled students can see/download it. */
export async function publishMaterial(
  courseUnitId: string,
  materialId: string,
): Promise<CourseMaterial> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/course-units/${encodeURIComponent(courseUnitId)}/materials/${encodeURIComponent(materialId)}/publish`,
    ),
    { method: "POST" },
  );
  const data = await unwrap<{ material: CourseMaterial }>(
    res,
    "Failed to publish material",
  );
  return data.material;
}

/** Revert a published material back to draft (hides it from students). */
export async function unpublishMaterial(
  courseUnitId: string,
  materialId: string,
): Promise<CourseMaterial> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/course-units/${encodeURIComponent(courseUnitId)}/materials/${encodeURIComponent(materialId)}/unpublish`,
    ),
    { method: "POST" },
  );
  const data = await unwrap<{ material: CourseMaterial }>(
    res,
    "Failed to unpublish material",
  );
  return data.material;
}

/** Permanently delete a material and its stored file. */
export async function deleteMaterial(
  courseUnitId: string,
  materialId: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/course-units/${encodeURIComponent(courseUnitId)}/materials/${encodeURIComponent(materialId)}`,
    ),
    { method: "DELETE" },
  );
  await unwrap<{ ok: boolean }>(res, "Failed to delete material");
}

/** Cookie-authenticated download URL for a material. A plain navigation
 * triggers the download since auth is a same-origin cookie. */
export function materialDownloadUrl(
  courseUnitId: string,
  materialId: string,
): string {
  return apiUrl(
    `/api/v1/multi-user/admin/course-units/${encodeURIComponent(courseUnitId)}/materials/${encodeURIComponent(materialId)}/download`,
  );
}