"""Seed realistic Ugandan test data via the live HTTP API — instructors,
students (mixed gender / masters-PhD, real profile fields filled in),
course units across two terms, assignments (a mix of "several quizzes + one
final" and "one quiz + one final" instructor styles), and submissions with
deliberately varied correctness so some students pass, some fail, and a few
are left incomplete.

Deliberately API-only (no direct DB writes) so it exercises the same code
paths a real admin/instructor/student would hit, and deliberately avoids
the chat/LLM surface entirely — every assignment question is multiple-choice
("choice" type), which the backend grades by exact string match with no LLM
call involved (see grading.py's QUESTION_TYPES_AUTO_GRADABLE).

Usage (from inside the running container, backend reachable on :8001):
    python scripts/seed_uganda_test_data.py

Safe-ish to re-run: user creation is skipped (not overwritten) if the
username already exists, and course units are only created if a course of
that exact name doesn't already exist for that term. Enrollments/assignments/
submissions are NOT de-duplicated beyond that, so re-running after a partial
failure may create some duplicate assignments — check before re-running.
"""

from __future__ import annotations

import random
import sys

import httpx

BASE = "http://localhost:8001"
ADMIN_USERNAME = "testadmin"
ADMIN_PASSWORD = "Tst_Adm1n_2026!Qx"
TEST_PASSWORD = "UgTest2026!"

random.seed(42)  # reproducible run-to-run

# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

INSTRUCTORS = [
    {"username": "sarah.nakato", "full_name": "Sarah Nakato", "gender": "female"},
    {"username": "peter.okello", "full_name": "Peter Okello", "gender": "male"},
]

# (first, surname, gender, course) — a spread of Ugandan names, both
# genders, both degree types.
STUDENTS = [
    ("Ronald", "Kato", "male", "masters"),
    ("Moses", "Ssekandi", "male", "masters"),
    ("Ivan", "Byaruhanga", "male", "masters"),
    ("Brian", "Tumusiime", "male", "masters"),
    ("David", "Okello", "male", "masters"),
    ("Joseph", "Kiggundu", "male", "phd"),
    ("Emmanuel", "Otim", "male", "phd"),
    ("Peter", "Wasswa", "male", "phd"),
    ("Daniel", "Mukasa", "male", "phd"),
    ("Samuel", "Ochieng", "male", "phd"),
    ("Sarah", "Nabirye", "female", "masters"),
    ("Grace", "Namutebi", "female", "masters"),
    ("Patricia", "Nansubuga", "female", "masters"),
    ("Esther", "Achieng", "female", "masters"),
    ("Joan", "Namusoke", "female", "masters"),
    ("Betty", "Nakato", "female", "phd"),
    ("Susan", "Auma", "female", "phd"),
    ("Diana", "Kobusingye", "female", "phd"),
    ("Florence", "Nankya", "female", "phd"),
    ("Christine", "Apio", "female", "phd"),
]
# The last two students are deliberately left unenrolled anywhere, so the
# "not enrolled" / orphan-student case is represented on the dashboards too.
UNENROLLED_COUNT = 2


def _question(topic: str, n: int) -> dict:
    """A generic-but-topic-flavored multiple-choice question. Content is a
    placeholder — this is test data, not real course material."""
    correct = random.choice(["a", "b", "c", "d"])
    return {
        "question": f"{topic} — question {n}: which option best fits?",
        "question_type": "choice",
        "options": {
            "a": f"{topic} concept {n}A",
            "b": f"{topic} concept {n}B",
            "c": f"{topic} concept {n}C",
            "d": f"{topic} concept {n}D",
        },
        "correct_answer": correct,
        "explanation": f"Option {correct} is correct for this placeholder question.",
        "points": 1.0,
    }


# course_key -> (name, term, instructor_username, [(title, n_questions, is_major, weight), ...])
COURSES = {
    "data_science": (
        "Introduction to Data Science",
        "2025 Semester 2",
        "sarah.nakato",
        [
            ("Quiz 1: Data Basics", 5, False, 1.0),
            ("Quiz 2: Data Cleaning", 5, False, 1.0),
            ("Quiz 3: Exploratory Analysis", 5, False, 1.0),
            ("Final Exam", 10, True, 3.0),
        ],
    ),
    "ml_fundamentals": (
        "Machine Learning Fundamentals",
        "2025 Semester 2",
        "peter.okello",
        [
            ("Quiz 1: ML Concepts", 5, False, 1.0),
            ("Final Exam", 8, True, 3.0),
        ],
    ),
    "advanced_stats": (
        "Advanced Statistics",
        "2026 Semester 1",
        "sarah.nakato",
        [
            ("Quiz 1: Probability", 5, False, 1.0),
            ("Quiz 2: Inference", 5, False, 1.0),
            ("Final Exam", 10, True, 3.0),
        ],
    ),
    "research_methods": (
        "Research Methods",
        "2026 Semester 1",
        "peter.okello",
        [
            ("Quiz 1: Study Design", 5, False, 1.0),
            ("Final Exam", 8, True, 3.0),
        ],
    ),
}

# Which students (by index into STUDENTS) enroll in which courses.
# First 10 students -> the two 2025 Semester 2 courses.
# Next 8 students (indices 10-17) -> the two 2026 Semester 1 courses.
# Last 2 (18, 19) stay unenrolled anywhere.
ENROLLMENT_PLAN = {
    "data_science": list(range(0, 10)),
    "ml_fundamentals": list(range(0, 10)),
    "advanced_stats": list(range(10, 18)),
    "research_methods": list(range(10, 18)),
}

# Per-student performance archetype, cycling so every course gets a mix.
# "high": ~90% correct, submits everything -> completes with a strong score.
# "average": ~65% correct, submits everything -> completes, mid score.
# "struggling": ~25% correct, submits everything -> completes but fails
#   (below a typical passing_score), showing up as a real "failed" case.
# "incomplete": skips the final exam -> never auto-completes the course.
ARCHETYPE_CYCLE = ["high", "high", "average", "average", "struggling", "incomplete"]


def archetype_for(student_index: int) -> str:
    return ARCHETYPE_CYCLE[student_index % len(ARCHETYPE_CYCLE)]


def answer_for(question: dict, archetype: str) -> str:
    correct = question["correct_answer"]
    wrong_choices = [k for k in question["options"] if k != correct]
    if archetype == "high":
        return correct if random.random() < 0.9 else random.choice(wrong_choices)
    if archetype == "average":
        return correct if random.random() < 0.65 else random.choice(wrong_choices)
    if archetype == "struggling":
        return correct if random.random() < 0.25 else random.choice(wrong_choices)
    return correct  # unused for "incomplete" (that assignment gets skipped)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def login(username: str, password: str) -> httpx.Client:
    client = httpx.Client(base_url=BASE, timeout=30.0)
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    resp.raise_for_status()
    return client


def get_users(admin: httpx.Client) -> dict[str, dict]:
    resp = admin.get("/api/v1/auth/users")
    resp.raise_for_status()
    return {u["username"]: u for u in resp.json()}


def ensure_user(admin: httpx.Client, existing: dict[str, dict], username: str, password: str) -> dict:
    if username in existing:
        return existing[username]
    resp = admin.post("/api/v1/auth/users", json={"username": username, "password": password})
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    print("Logging in as admin...")
    admin = login(ADMIN_USERNAME, ADMIN_PASSWORD)

    existing = get_users(admin)

    # --- Instructors ---
    instructor_ids: dict[str, str] = {}
    for inst in INSTRUCTORS:
        username = inst["username"]
        created = ensure_user(admin, existing, username, TEST_PASSWORD)
        user_id = created.get("user_id") or created.get("id") or existing.get(username, {}).get("id")
        if username not in existing:
            resp = admin.put(f"/api/v1/auth/users/{username}/role", json={"role": "instructor"})
            resp.raise_for_status()
            print(f"Created instructor {username}")
        else:
            print(f"Instructor {username} already exists, skipping")
        instructor_ids[username] = user_id
    existing = get_users(admin)
    for username in instructor_ids:
        instructor_ids[username] = existing[username]["id"]

    # Set instructor profile details (full name + gender) by logging in as them.
    for inst in INSTRUCTORS:
        first, _, surname = inst["full_name"].partition(" ")
        client = login(inst["username"], TEST_PASSWORD)
        client.put(
            "/api/v1/auth/profile/details",
            json={
                "full_name": inst["full_name"],
                "first_name": first,
                "surname": surname,
                "gender": inst["gender"],
            },
        ).raise_for_status()
        client.close()

    # --- Students ---
    student_ids: list[str] = []  # parallel to STUDENTS
    student_usernames: list[str] = []
    for i, (first, surname, gender, course) in enumerate(STUDENTS):
        username = f"{first.lower()}.{surname.lower()}"
        created = ensure_user(admin, existing, username, TEST_PASSWORD)
        if username not in existing:
            print(f"Created student {username} ({gender}, {course})")
        else:
            print(f"Student {username} already exists, skipping creation")
        student_usernames.append(username)

    existing = get_users(admin)
    for username in student_usernames:
        student_ids.append(existing[username]["id"])

    reg_counters = {"masters": 0, "phd": 0}
    for i, (first, surname, gender, course) in enumerate(STUDENTS):
        reg_counters[course] += 1
        reg_number = f"{'MSC' if course == 'masters' else 'PHD'}/2026/{reg_counters[course]:03d}"
        client = login(student_usernames[i], TEST_PASSWORD)
        client.put(
            "/api/v1/auth/profile/details",
            json={
                "full_name": f"{first} {surname}",
                "first_name": first,
                "surname": surname,
                "gender": gender,
                "course": course,
                "registration_number": reg_number,
            },
        ).raise_for_status()
        client.close()
    print(f"Set profile details for {len(STUDENTS)} students")

    # --- Course units ---
    course_unit_ids: dict[str, str] = {}
    resp = admin.get("/api/v1/multi-user/course-units", params={"limit": 200})
    resp.raise_for_status()
    existing_units = {u["name"]: u["id"] for u in resp.json()["course_units"]}

    for key, (name, term, instructor_username, _assignments) in COURSES.items():
        if name in existing_units:
            course_unit_ids[key] = existing_units[name]
            print(f"Course unit '{name}' already exists, skipping creation")
            continue
        resp = admin.post(
            "/api/v1/multi-user/course-units",
            json={
                "name": name,
                "term": term,
                "description": f"Test data course unit — {name} ({term}).",
                "instructor_ids": [instructor_ids[instructor_username]],
            },
        )
        resp.raise_for_status()
        course_unit_ids[key] = resp.json()["course_unit"]["id"]
        print(f"Created course unit '{name}' ({term})")

    # --- Enrollments ---
    for key, student_indices in ENROLLMENT_PLAN.items():
        cu_id = course_unit_ids[key]
        for idx in student_indices:
            resp = admin.post(
                f"/api/v1/multi-user/course-units/{cu_id}/enrollments",
                json={"user_id": student_ids[idx]},
            )
            if resp.status_code not in (200, 409):
                resp.raise_for_status()
    print("Enrolled students into course units")

    # --- Assignments (created + published by the instructor) ---
    assignment_map: dict[str, list[dict]] = {}  # course_key -> [{id, questions}, ...]
    for key, (name, term, instructor_username, spec) in COURSES.items():
        cu_id = course_unit_ids[key]
        instructor_client = login(instructor_username, TEST_PASSWORD)
        assignment_map[key] = []
        for title, n_questions, is_major, weight in spec:
            questions = [_question(name, n) for n in range(1, n_questions + 1)]
            resp = instructor_client.post(
                f"/api/v1/multi-user/course-units/{cu_id}/assignments",
                json={
                    "title": title,
                    "description": f"{title} for {name}.",
                    "questions": questions,
                    "weight": weight,
                    "attempt_limit": 1,
                    "is_major": is_major,
                    "passing_score": 50.0,
                },
            )
            resp.raise_for_status()
            created = resp.json()["assignment"]
            assignment_id = created["id"]
            # Use the server-echoed questions (each now carries a generated
            # question_id) rather than the locally-built list — submissions
            # are matched to questions by that id.
            server_questions = created["questions"]
            publish_resp = instructor_client.post(f"/api/v1/multi-user/assignments/{assignment_id}/publish")
            publish_resp.raise_for_status()
            assignment_map[key].append(
                {"id": assignment_id, "questions": server_questions, "is_major": is_major}
            )
            print(f"Created + published '{title}' in '{name}'")
        instructor_client.close()

    # --- Submissions ---
    for key, student_indices in ENROLLMENT_PLAN.items():
        for idx in student_indices:
            archetype = archetype_for(idx)
            client = login(student_usernames[idx], TEST_PASSWORD)
            for assignment in assignment_map[key]:
                if archetype == "incomplete" and assignment["is_major"]:
                    continue  # deliberately skip the final -> never auto-completes
                answers = [
                    {"question_id": q["question_id"], "answer": answer_for(q, archetype)}
                    for q in assignment["questions"]
                ]
                resp = client.post(
                    f"/api/v1/multi-user/assignments/{assignment['id']}/submit",
                    json={"answers": answers},
                )
                if resp.status_code != 200:
                    print(f"  submit failed for {student_usernames[idx]}: {resp.status_code} {resp.text[:200]}")
            # Visiting the catalog as this student triggers the completion
            # check for every course they're approved-enrolled in.
            client.get("/api/v1/multi-user/course-units/catalog")
            client.close()
        print(f"Submitted assignments for '{key}'")

    print("\nDone. Seeded:")
    print(f"  {len(INSTRUCTORS)} instructors, {len(STUDENTS)} students "
          f"({UNENROLLED_COUNT} left unenrolled)")
    print(f"  {len(COURSES)} course units across 2 terms")
    print(f"  Login as any seeded account with password: {TEST_PASSWORD}")


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as exc:
        print(f"\nHTTP error: {exc.response.status_code} {exc.response.text}", file=sys.stderr)
        raise
