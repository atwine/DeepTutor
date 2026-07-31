import { apiFetch, apiUrl } from "@/lib/api";

export interface CourseUnit {
  id: string;
  name: string;
  term: string;
  instructor_ids: string[];
  /** Server-resolved usernames for `instructor_ids`, same order — lets a
   * non-admin instructor see a co-instructor's name without needing the
   * admin-only user list. */
  instructor_usernames: string[];
  created_at: string;
}

export interface RosterEntry {
  user_id: string;
  username: string;
  role: string;
  enrolled_at: string;
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
): Promise<CourseUnit> {
  const res = await apiFetch(apiUrl("/api/v1/multi-user/course-units"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, term, instructor_ids: instructorIds }),
  });
  const data = await unwrap<{ course_unit: CourseUnit }>(
    res,
    "Failed to create course unit",
  );
  return data.course_unit;
}

export async function updateCourseUnit(
  courseUnitId: string,
  updates: Partial<Pick<CourseUnit, "name" | "term" | "instructor_ids">>,
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
