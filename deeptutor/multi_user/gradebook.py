"""Gradebook: aggregates each enrolled student's assignment scores into a
weighted final grade for a course unit — the payoff that replaces manual
Excel-based grade tracking.

Pure aggregation over existing records (course_units.py's roster,
assignments.py's Assignment/Submission) — no storage of its own. A
student's *latest* submission to an assignment is what counts (matches what
the student's own results page already shows them).

NOTE: functions are now ``async def`` because the storage functions they
call (``list_enrollments_for_course``, ``list_assignments_for_course``,
``get_latest_submission``) became async as part of the DB migration.
This is a scope surprise flagged per DATABASE_MIGRATION_PLAN.md §3 —
the logic is identical, only ``await`` was added.
"""

from __future__ import annotations

import asyncio
import csv
import io
from typing import Any

from .assignments import (
    get_latest_submission,
    get_latest_submissions_batch,
    list_assignments_for_course,
)
from .course_units import (
    check_and_mark_completion,
    check_and_mark_completion_batch,
    list_course_units_for_instructor,
    list_enrollments_for_course,
)
from .identity import get_user_by_id, get_users_by_ids


def assignment_max_points(assignment: dict[str, Any]) -> float:
    return sum(float(q.get("points") or 1.0) for q in assignment.get("questions", []))


async def build_gradebook(course_unit_id: str) -> dict[str, Any]:
    assignments = [
        a for a in await list_assignments_for_course(course_unit_id) if a["status"] == "published"
    ]
    enrollments = [
        e
        for e in await list_enrollments_for_course(course_unit_id)
        if e.get("status", "approved") == "approved"
    ]

    assignment_summaries = [
        {
            "id": a["id"],
            "title": a["title"],
            "weight": a["weight"],
            "max_points": assignment_max_points(a),
        }
        for a in assignments
    ]

    # Issue #31: batched submission lookup — one query for all assignments
    # at once, instead of N_students × N_assignments individual queries.
    # The dict is keyed by (assignment_id, user_id) for O(1) lookups below.
    submission_batch = await get_latest_submissions_batch(
        [a["id"] for a in assignments]
    )

    # Issue #31: batched completion check — one query for all students,
    # instead of one session per student inside check_and_mark_completion.
    user_ids = [e["user_id"] for e in enrollments]
    completion_map = await check_and_mark_completion_batch(
        course_unit_id,
        user_ids,
        published_assignments=assignments,
        submission_batch=submission_batch,
    )

    # Issue #31: batched user identity lookup — load the JSON store once
    # instead of N_students times (each get_user_by_id re-reads the file).
    user_records = await get_users_by_ids(user_ids)

    rows: list[dict[str, Any]] = []
    for enrollment in enrollments:
        user_id = enrollment["user_id"]
        user_record = user_records.get(user_id)
        username = user_record[0] if user_record else user_id
        full_name = str(user_record[1].get("full_name") or "") if user_record else ""
        registration_number = (
            str(user_record[1].get("registration_number") or "") if user_record else ""
        )

        per_assignment: list[dict[str, Any]] = []
        weighted_sum = 0.0
        weight_total = 0.0
        for assignment in assignments:
            submission = submission_batch.get((assignment["id"], user_id))
            max_points = assignment_max_points(assignment)
            score = submission["score"] if submission else None
            percentage = (score / max_points * 100) if submission and max_points else None
            per_assignment.append(
                {
                    "assignment_id": assignment["id"],
                    "score": score,
                    "max_score": max_points,
                    "percentage": percentage,
                }
            )
            if percentage is not None:
                weighted_sum += percentage * assignment["weight"]
                weight_total += assignment["weight"]

        final_grade = (weighted_sum / weight_total) if weight_total > 0 else None
        # Issue #4: completion status from the batched check above.
        completed_at = completion_map.get(user_id, "")
        rows.append(
            {
                "user_id": user_id,
                "username": username,
                "full_name": full_name,
                "registration_number": registration_number,
                "assignments": per_assignment,
                "final_grade": final_grade,
                "completed_at": completed_at,
            }
        )

    return {"assignments": assignment_summaries, "rows": rows}


async def build_gradebook_csv(course_unit_id: str) -> str:
    data = await build_gradebook(course_unit_id)
    assignments = data["assignments"]

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    header = ["Username", "Full Name", "Registration Number"]
    for a in assignments:
        header.append(f"{a['title']} (/{a['max_points']:.1f})")
    header.append("Final Grade (%)")
    writer.writerow(header)

    for row in data["rows"]:
        by_id = {pa["assignment_id"]: pa for pa in row["assignments"]}
        line = [row["username"], row["full_name"], row["registration_number"]]
        for a in assignments:
            pa = by_id.get(a["id"])
            line.append(f"{pa['score']:.1f}" if pa and pa["score"] is not None else "")
        line.append(f"{row['final_grade']:.1f}" if row["final_grade"] is not None else "")
        writer.writerow(line)

    return buffer.getvalue()


# ---------------------------------------------------------------------------
# B3: Cross-course per-instructor compiled report
# ---------------------------------------------------------------------------


async def build_instructor_report(instructor_id: str, term: str | None = None) -> dict[str, Any]:
    """B3: Compile gradebook data across every course unit an instructor
    teaches, optionally filtered by ``term``. Reuses ``build_gradebook``
    internally per unit — does NOT re-derive the weighted-average math.

    Issue #43: Gradebooks for all course units are built in parallel
    with ``asyncio.gather()`` and a concurrency limit of 10, instead
    of sequentially awaiting each ``build_gradebook()`` call in a loop.
    """
    units = await list_course_units_for_instructor(instructor_id)
    if term:
        units = [u for u in units if u.get("term", "") == term]

    if not units:
        return {
            "instructor_id": instructor_id,
            "term": term,
            "course_units": [],
            "total_students": 0,
            "total_assignments": 0,
        }

    # Issue #43: Build all gradebooks in parallel with a concurrency
    # limit to avoid overwhelming the DB connection pool when an
    # instructor has many course units.
    sem = asyncio.Semaphore(10)

    async def _build_one(unit: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            gradebook = await build_gradebook(unit["id"])
            return {
                "id": unit["id"],
                "name": unit["name"],
                "term": unit.get("term", ""),
                "assignments": gradebook["assignments"],
                "rows": gradebook["rows"],
                "student_count": len(gradebook["rows"]),
                "assignment_count": len(gradebook["assignments"]),
            }

    course_unit_reports = await asyncio.gather(*[_build_one(u) for u in units])

    total_students = sum(r["student_count"] for r in course_unit_reports)
    total_assignments = sum(r["assignment_count"] for r in course_unit_reports)

    return {
        "instructor_id": instructor_id,
        "term": term,
        "course_units": list(course_unit_reports),
        "total_students": total_students,
        "total_assignments": total_assignments,
    }


async def build_instructor_report_csv(instructor_id: str, term: str | None = None) -> str:
    """B3: CSV export of the per-instructor compiled report. Per-unit sections,
    each with its own assignment columns and student rows."""
    report = await build_instructor_report(instructor_id, term)

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    for unit_report in report["course_units"]:
        writer.writerow([])
        writer.writerow([f"=== {unit_report['name']} ({unit_report['term'] or 'No term'}) ==="])
        assignments = unit_report["assignments"]
        header = ["Username", "Full Name", "Registration Number"]
        for a in assignments:
            header.append(f"{a['title']} (/{a['max_points']:.1f})")
        header.append("Final Grade (%)")
        writer.writerow(header)

        for row in unit_report["rows"]:
            by_id = {pa["assignment_id"]: pa for pa in row["assignments"]}
            line = [row["username"], row["full_name"], row["registration_number"]]
            for a in assignments:
                pa = by_id.get(a["id"])
                line.append(f"{pa['score']:.1f}" if pa and pa["score"] is not None else "")
            line.append(f"{row['final_grade']:.1f}" if row['final_grade'] is not None else "")
            writer.writerow(line)

    return buffer.getvalue()
