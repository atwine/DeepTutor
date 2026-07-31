import { apiFetch, apiUrl } from "@/lib/api";

export interface GradebookAssignment {
  id: string;
  title: string;
  weight: number;
  max_points: number;
}

export interface GradebookAssignmentResult {
  assignment_id: string;
  score: number | null;
  max_score: number;
  percentage: number | null;
}

export interface GradebookRow {
  user_id: string;
  username: string;
  full_name: string;
  registration_number: string;
  assignments: GradebookAssignmentResult[];
  final_grade: number | null;
}

export interface Gradebook {
  assignments: GradebookAssignment[];
  rows: GradebookRow[];
}

export async function getGradebook(courseUnitId: string): Promise<Gradebook> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/gradebook`),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? "Failed to load gradebook");
  }
  return res.json();
}

/** Server-rendered CSV, cookie-authenticated — a plain navigation triggers
 * the download since auth here is a same-origin cookie, not a bearer token
 * the browser wouldn't otherwise send. */
export function gradebookExportUrl(courseUnitId: string): string {
  return apiUrl(
    `/api/v1/multi-user/course-units/${encodeURIComponent(courseUnitId)}/gradebook/export`,
  );
}
