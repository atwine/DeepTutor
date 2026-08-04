"""
Seed script: creates a realistic multi-user test environment.

Run inside the Docker container:
    docker exec deeptutor python /app/_seed.py

Creates:
  - 2 instructors + 5 students (via identity.save_user)
  - 3 course units with instructor assignments
  - Enrollments with overlap (S3 in 2 courses, S4 in 2 courses)
  - 3 assignments (published) with questions
  - Submissions + grading for some students
  - Course material records (DB only, no files)

Idempotent: cleans up all seed data before re-creating.
All seed users get password "testpass123".
"""
import asyncio
import sys
import json
from datetime import datetime, timezone

sys.path.insert(0, "/app")


# ─── Seed data definition ───────────────────────────────────────────────

SEED_PASSWORD = "testpass123"

USERS = [
    # (username, role, full_name)
    ("instr_a", "instructor", "Alice Anderson"),
    ("instr_b", "instructor", "Bob Brown"),
    ("stud1", "user", "Student One"),
    ("stud2", "user", "Student Two"),
    ("stud3", "user", "Student Three"),
    ("stud4", "user", "Student Four"),
    ("stud5", "user", "Student Five"),
]

# Course units: (name, term, description, instructor_username)
COURSES = [
    ("Data Structures", "2026 Fall", "Intro to DS", "instr_a"),
    ("Algorithms", "2026 Fall", "Algorithm design", "instr_a"),
    ("Databases", "2026 Spring", "DB fundamentals", "instr_b"),
]

# Enrollments: (course_index, student_username)
# Course 0 (Data Structures): stud1, stud2, stud3
# Course 1 (Algorithms):      stud3, stud4
# Course 2 (Databases):       stud4, stud5
ENROLLMENTS = [
    (0, "stud1"),
    (0, "stud2"),
    (0, "stud3"),
    (1, "stud3"),
    (1, "stud4"),
    (2, "stud4"),
    (2, "stud5"),
]

# Assignments: (course_index, title, description, status, questions)
# Questions follow the _normalize_question shape from assignments.py
QUESTIONS_DS = [
    {
        "question_id": "q1",
        "question": "What is the time complexity of inserting an element at the head of a singly linked list?",
        "question_type": "short_answer",
        "options": None,
        "correct_answer": "O(1)",
        "explanation": "Inserting at the head only requires updating the head pointer, which is constant time.",
        "points": 5.0,
    },
    {
        "question_id": "q2",
        "question": "Which data structure uses FIFO ordering?",
        "question_type": "multiple_choice",
        "options": {"A": "Stack", "B": "Queue", "C": "Tree", "D": "Heap"},
        "correct_answer": "B",
        "explanation": "A queue follows First-In-First-Out ordering.",
        "points": 5.0,
    },
]

QUESTIONS_ALGO = [
    {
        "question_id": "q1",
        "question": "What is the worst-case time complexity of quicksort?",
        "question_type": "short_answer",
        "options": None,
        "correct_answer": "O(n^2)",
        "explanation": "Quicksort degrades to O(n^2) when the pivot is always the smallest or largest element.",
        "points": 10.0,
    },
]

QUESTIONS_DB = [
    {
        "question_id": "q1",
        "question": "What does ACID stand for in database transactions?",
        "question_type": "short_answer",
        "options": None,
        "correct_answer": "Atomicity, Consistency, Isolation, Durability",
        "explanation": "ACID properties guarantee reliable database transactions.",
        "points": 10.0,
    },
    {
        "question_id": "q2",
        "question": "Which SQL clause is used to filter rows?",
        "question_type": "multiple_choice",
        "options": {"A": "GROUP BY", "B": "ORDER BY", "C": "WHERE", "D": "HAVING"},
        "correct_answer": "C",
        "explanation": "WHERE filters rows before grouping; HAVING filters after GROUP BY.",
        "points": 5.0,
    },
]

ASSIGNMENTS = [
    (0, "DS Quiz 1", "Linked lists and queues", "published", QUESTIONS_DS),
    (1, "Algorithms Midterm", "Sorting algorithms", "published", QUESTIONS_ALGO),
    (2, "DB Quiz 1", "Transactions and SQL", "published", QUESTIONS_DB),
]

# Submissions: (assignment_index, student_username, answers, score, max_score)
# We pre-grade these (no LLM call needed) to have deterministic results.
SUBMISSIONS = [
    # DS Quiz 1: stud1 gets full marks, stud2 gets partial
    (0, "stud1", [{"question_id": "q1", "answer": "O(1)"}, {"question_id": "q2", "answer": "B"}],
     10.0, 10.0, True, True),  # all correct
    (0, "stud2", [{"question_id": "q1", "answer": "O(n)"}, {"question_id": "q2", "answer": "B"}],
     5.0, 10.0, False, True),  # q1 wrong, q2 correct
    # Algorithms Midterm: stud3 submits, not graded yet (score 0)
    (1, "stud3", [{"question_id": "q1", "answer": "O(n log n)"}],
     0.0, 10.0, False, False),  # wrong answer
    # DB Quiz 1: stud5 gets full marks
    (2, "stud5", [{"question_id": "q1", "answer": "Atomicity, Consistency, Isolation, Durability"}, {"question_id": "q2", "answer": "C"}],
     15.0, 15.0, True, True),  # all correct
]


# ─── Seed implementation ────────────────────────────────────────────────

async def cleanup_seed_data():
    """Remove all seed-created data so the script is idempotent."""
    from deeptutor.services.db import session_scope
    from deeptutor.services.db.models import (
        Assignment, Submission, Enrollment, CourseUnit, CourseUnitInstructor,
        CourseMaterial, AssignmentAccessGrant,
    )
    from sqlalchemy import delete, select

    seed_usernames = {u[0] for u in USERS}
    seed_course_names = {c[0] for c in COURSES}

    async with session_scope() as session:
        # Find seed course unit ids
        result = await session.execute(
            select(CourseUnit).where(CourseUnit.name.in_(seed_course_names))
        )
        seed_course_ids = [cu.id for cu in result.scalars().all()]

        if seed_course_ids:
            # Delete submissions for assignments in seed courses
            result = await session.execute(
                select(Assignment).where(Assignment.course_unit_id.in_(seed_course_ids))
            )
            seed_asg_ids = [a.id for a in result.scalars().all()]
            if seed_asg_ids:
                await session.execute(
                    delete(Submission).where(Submission.assignment_id.in_(seed_asg_ids))
                )
                await session.execute(
                    delete(AssignmentAccessGrant).where(
                        AssignmentAccessGrant.assignment_id.in_(seed_asg_ids)
                    )
                )
            # Delete assignments
            await session.execute(
                delete(Assignment).where(Assignment.course_unit_id.in_(seed_course_ids))
            )
            # Delete materials
            await session.execute(
                delete(CourseMaterial).where(CourseMaterial.course_unit_id.in_(seed_course_ids))
            )
            # Delete enrollments
            await session.execute(
                delete(Enrollment).where(Enrollment.course_unit_id.in_(seed_course_ids))
            )
            # Delete instructor links
            await session.execute(
                delete(CourseUnitInstructor).where(
                    CourseUnitInstructor.course_unit_id.in_(seed_course_ids)
                )
            )
            # Delete course units
            await session.execute(
                delete(CourseUnit).where(CourseUnit.id.in_(seed_course_ids))
            )

    # Remove seed users from identity store
    from deeptutor.multi_user.identity import load_users, _write_users
    users = load_users()
    changed = False
    for username in seed_usernames:
        if username in users:
            del users[username]
            changed = True
    if changed:
        _write_users(users)

    print(f"  Cleaned up {len(seed_course_ids)} seed course units and {len(seed_usernames)} seed users")


async def seed_users():
    """Create seed users via the identity system."""
    from deeptutor.services.auth import hash_password
    from deeptutor.multi_user.identity import save_user

    user_ids = {}
    for username, role, full_name in USERS:
        record = save_user(username, hash_password(SEED_PASSWORD), role=role)
        user_ids[username] = record["id"]
        print(f"  Created user: {username} (id={record['id']}, role={role})")
    return user_ids


async def seed_courses(user_ids):
    """Create course units and assign instructors."""
    from deeptutor.multi_user.course_units import create_course_unit

    course_ids = []
    for name, term, desc, instr_username in COURSES:
        instr_id = user_ids[instr_username]
        unit = await create_course_unit(
            name=name,
            term=term,
            description=desc,
            instructor_ids=[instr_id],
        )
        course_ids.append(unit["id"])
        print(f"  Created course: {name} (id={unit['id']}, instructor={instr_username})")
    return course_ids


async def seed_enrollments(course_ids, user_ids):
    """Enroll students in course units."""
    from deeptutor.multi_user.course_units import enroll_student

    for course_idx, stud_username in ENROLLMENTS:
        course_id = course_ids[course_idx]
        stud_id = user_ids[stud_username]
        enrollment = await enroll_student(course_id, stud_id)
        print(f"  Enrolled {stud_username} in course {course_idx} ({enrollment['status']})")


async def seed_assignments(course_ids, user_ids):
    """Create assignments with questions."""
    from deeptutor.multi_user.assignments import create_assignment

    assignment_ids = []
    for course_idx, title, desc, status, questions in ASSIGNMENTS:
        course_id = course_ids[course_idx]
        # Use the course's instructor as created_by
        instr_username = COURSES[course_idx][3]
        instr_id = user_ids[instr_username]
        assignment = await create_assignment(
            course_unit_id=course_id,
            title=title,
            description=desc,
            questions=questions,
            created_by=instr_id,
        )
        # Publish if status is 'published'
        if status == "published":
            from deeptutor.multi_user.assignments import publish_assignment
            await publish_assignment(assignment["id"])
        assignment_ids.append(assignment["id"])
        print(f"  Created assignment: {title} (id={assignment['id']}, status={status})")
    return assignment_ids


async def seed_submissions(assignment_ids, user_ids):
    """Create pre-graded submissions."""
    from deeptutor.services.db import session_scope
    from deeptutor.services.db.models import Submission
    from deeptutor.multi_user.assignments import _submission_to_dict

    for asg_idx, stud_username, answers, score, max_score, q1_correct, q2_correct in SUBMISSIONS:
        asg_id = assignment_ids[asg_idx]
        stud_id = user_ids[stud_username]

        # Build question_results from the answers
        questions = ASSIGNMENTS[asg_idx][4]
        question_results = []
        for i, ans in enumerate(answers):
            q = questions[i]
            is_correct = (i == 0 and q1_correct) or (i == 1 and q2_correct)
            q_score = q["points"] if is_correct else 0.0
            question_results.append({
                "question_id": q["question_id"],
                "question": q["question"],
                "user_answer": ans["answer"],
                "is_correct": is_correct,
                "score": q_score,
                "max_score": q["points"],
                "feedback": "Correct!" if is_correct else "Incorrect — see explanation.",
            })

        async with session_scope() as session:
            sub = Submission(
                assignment_id=asg_id,
                user_id=stud_id,
                answers=answers,
                question_results=question_results,
                score=score,
                max_score=max_score,
            )
            session.add(sub)
            await session.flush()
            print(f"  Created submission: {stud_username} -> assignment {asg_idx} (score={score}/{max_score})")


async def seed_materials(course_ids):
    """Create course material DB records (no actual files — just DB rows for testing visibility)."""
    from deeptutor.services.db import session_scope
    from deeptutor.services.db.models import CourseMaterial
    from datetime import datetime, timezone

    # Course 0 (Data Structures): 1 published, 1 draft
    # Course 2 (Databases): 1 published
    materials = [
        (course_ids[0], "Intro_to_Linked_Lists.pdf", "published", "ready", 102400),
        (course_ids[0], "Queue_Implementation_Notes.pdf", "draft", "pending", 51200),
        (course_ids[2], "ACID_Transactions.pdf", "published", "ready", 204800),
    ]

    async with session_scope() as session:
        for course_id, filename, status, ingestion, size in materials:
            mat = CourseMaterial(
                id=f"mat_seed_{filename[:10]}",
                course_unit_id=course_id,
                filename=filename,
                file_path=filename,
                file_type="pdf",
                size_bytes=size,
                status=status,
                ingestion_status=ingestion,
            )
            session.add(mat)
            print(f"  Created material: {filename} (course={course_id[:8]}..., status={status})")
        await session.flush()


async def main():
    print("=" * 60)
    print("SEED SCRIPT: Multi-user test environment")
    print("=" * 60)

    print("\n[1/6] Cleaning up existing seed data...")
    await cleanup_seed_data()

    print("\n[2/6] Creating users...")
    user_ids = await seed_users()

    print("\n[3/6] Creating course units...")
    course_ids = await seed_courses(user_ids)

    print("\n[4/6] Enrolling students...")
    await seed_enrollments(course_ids, user_ids)

    print("\n[5/6] Creating assignments...")
    assignment_ids = await seed_assignments(course_ids, user_ids)

    print("\n[6/6] Creating submissions and materials...")
    await seed_submissions(assignment_ids, user_ids)
    await seed_materials(course_ids)

    print("\n" + "=" * 60)
    print("SEED COMPLETE")
    print("=" * 60)
    print(f"\nUsers created: {len(USERS)} (password: {SEED_PASSWORD})")
    print(f"  admin:     admin (existing)")
    print(f"  instructors: instr_a, instr_b")
    print(f"  students:    stud1, stud2, stud3, stud4, stud5")
    print(f"\nCourses: {len(COURSES)}")
    print(f"  Course 0 (Data Structures, instr_a): stud1, stud2, stud3")
    print(f"  Course 1 (Algorithms, instr_a):      stud3, stud4")
    print(f"  Course 2 (Databases, instr_b):       stud4, stud5")
    print(f"\nAssignments: {len(ASSIGNMENTS)} (all published)")
    print(f"Submissions: {len(SUBMISSIONS)}")
    print(f"Materials: 3 (1 published + 1 draft in Course 0, 1 published in Course 2)")
    print(f"\nUser IDs for reference:")
    for username, uid in sorted(user_ids.items()):
        print(f"  {username}: {uid}")


if __name__ == "__main__":
    asyncio.run(main())
