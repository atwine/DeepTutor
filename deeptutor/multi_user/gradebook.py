"""Gradebook: aggregates each enrolled student's assignment scores into a
weighted final grade for a course unit — the payoff that replaces manual
Excel-based grade tracking.

Pure aggregation over existing records (course_units.py's roster,
assignments.py's Assignment/Submission) — no storage of its own. A
student's *latest* submission to an assignment is what counts (matches what
the student's own results page already shows them).
"""

from __future__ import annotations

import csv
import io
from typing import Any

from .assignments import get_latest_submission, list_assignments_for_course
from .course_units import list_enrollments_for_course
from .identity import get_user_by_id


def assignment_max_points(assignment: dict[str, Any]) -> float:
    return sum(float(q.get("points") or 1.0) for q in assignment.get("questions", []))


def build_gradebook(course_unit_id: str) -> dict[str, Any]:
    assignments = [
        a for a in list_assignments_for_course(course_unit_id) if a["status"] == "published"
    ]
    enrollments = [
        e
        for e in list_enrollments_for_course(course_unit_id)
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

    rows: list[dict[str, Any]] = []
    for enrollment in enrollments:
        user_id = enrollment["user_id"]
        user_record = get_user_by_id(user_id)
        username = user_record[0] if user_record else user_id
        full_name = str(user_record[1].get("full_name") or "") if user_record else ""
        registration_number = (
            str(user_record[1].get("registration_number") or "") if user_record else ""
        )

        per_assignment: list[dict[str, Any]] = []
        weighted_sum = 0.0
        weight_total = 0.0
        for assignment in assignments:
            submission = get_latest_submission(assignment["id"], user_id)
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
        rows.append(
            {
                "user_id": user_id,
                "username": username,
                "full_name": full_name,
                "registration_number": registration_number,
                "assignments": per_assignment,
                "final_grade": final_grade,
            }
        )

    return {"assignments": assignment_summaries, "rows": rows}


def build_gradebook_csv(course_unit_id: str) -> str:
    data = build_gradebook(course_unit_id)
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
