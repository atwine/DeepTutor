"""
Realistic load simulation: 1 course with 7 assignments (3 quizzes, 2 tests,
1 final exam, 1 makeup quiz) and 30 students, all with submissions.

Tests:
  - Gradebook correctness with weighted assignments
  - Completion tracking (all 30 should complete when all submit)
  - Performance: how long does build_gradebook take with 7×30 = 210 lookups?
  - CSV export correctness
  - Cross-course instructor report (if instructor teaches this + another course)

Run inside Docker:
    docker exec deeptutor python /app/_simulate_load.py
"""
import asyncio
import sys
import time
import json
from datetime import datetime, timezone

sys.path.insert(0, "/app")


# ─── Configuration ──────────────────────────────────────────────────────

COURSE_NAME = "Load Test: Intro to Computer Science"
COURSE_TERM = "2026 Fall"
NUM_STUDENTS = 30
PASSWORD = "testpass123"

# 7 assignments with realistic weights and types
# Quizzes: low weight, Tests: medium weight, Final: high weight
ASSIGNMENT_DEFS = [
    # (title, description, weight, is_major, passing_score, questions)
    ("Quiz 1: Basics", "Week 1-2 material", 1.0, False, None, [
        {"question_id": "q1", "question": "What does CPU stand for?", "question_type": "short_answer",
         "options": None, "correct_answer": "Central Processing Unit", "explanation": "", "points": 5.0},
        {"question_id": "q2", "question": "What does RAM stand for?", "question_type": "short_answer",
         "options": None, "correct_answer": "Random Access Memory", "explanation": "", "points": 5.0},
    ]),
    ("Quiz 2: Data Structures", "Week 3-4 material", 1.0, False, None, [
        {"question_id": "q1", "question": "Which structure is LIFO?", "question_type": "multiple_choice",
         "options": {"A": "Queue", "B": "Stack", "C": "Tree", "D": "Heap"},
         "correct_answer": "B", "explanation": "", "points": 5.0},
        {"question_id": "q2", "question": "What is the height of a balanced BST with n nodes?", "question_type": "short_answer",
         "options": None, "correct_answer": "O(log n)", "explanation": "", "points": 5.0},
    ]),
    ("Quiz 3: Algorithms", "Week 5-6 material", 1.0, False, None, [
        {"question_id": "q1", "question": "What is the best-case time for bubble sort?", "question_type": "short_answer",
         "options": None, "correct_answer": "O(n)", "explanation": "", "points": 5.0},
        {"question_id": "q2", "question": "Which sorting algorithm is stable?", "question_type": "multiple_choice",
         "options": {"A": "Quicksort", "B": "Heapsort", "C": "Merge sort", "D": "Selection sort"},
         "correct_answer": "C", "explanation": "", "points": 5.0},
    ]),
    ("Test 1: Midterm", "Covers weeks 1-7", 3.0, True, 50.0, [
        {"question_id": "q1", "question": "Explain the difference between BFS and DFS.", "question_type": "short_answer",
         "options": None, "correct_answer": "BFS uses queue, DFS uses stack", "explanation": "", "points": 15.0},
        {"question_id": "q2", "question": "What is the time complexity of binary search?", "question_type": "short_answer",
         "options": None, "correct_answer": "O(log n)", "explanation": "", "points": 10.0},
        {"question_id": "q3", "question": "Which data structure is best for priority queues?", "question_type": "multiple_choice",
         "options": {"A": "Array", "B": "Heap", "C": "Linked list", "D": "Hash table"},
         "correct_answer": "B", "explanation": "", "points": 10.0},
        {"question_id": "q4", "question": "What does Dijkstra's algorithm compute?", "question_type": "short_answer",
         "options": None, "correct_answer": "Shortest path in weighted graph", "explanation": "", "points": 15.0},
    ]),
    ("Test 2: Advanced Topics", "Covers weeks 8-12", 3.0, True, 50.0, [
        {"question_id": "q1", "question": "What is dynamic programming?", "question_type": "short_answer",
         "options": None, "correct_answer": "Breaking problems into overlapping subproblems", "explanation": "", "points": 15.0},
        {"question_id": "q2", "question": "What is memoization?", "question_type": "short_answer",
         "options": None, "correct_answer": "Caching results of function calls", "explanation": "", "points": 10.0},
        {"question_id": "q3", "question": "Which is NOT a greedy algorithm?", "question_type": "multiple_choice",
         "options": {"A": "Dijkstra's", "B": "Kruskal's", "C": "Bellman-Ford", "D": "Prim's"},
         "correct_answer": "C", "explanation": "", "points": 10.0},
        {"question_id": "q4", "question": "What is the space complexity of merge sort?", "question_type": "short_answer",
         "options": None, "correct_answer": "O(n)", "explanation": "", "points": 15.0},
    ]),
    ("Final Exam", "Comprehensive", 5.0, True, 60.0, [
        {"question_id": "q1", "question": "Define Big-O notation.", "question_type": "short_answer",
         "options": None, "correct_answer": "Upper bound on growth rate", "explanation": "", "points": 10.0},
        {"question_id": "q2", "question": "What is a hash collision?", "question_type": "short_answer",
         "options": None, "correct_answer": "Two keys mapping to same bucket", "explanation": "", "points": 10.0},
        {"question_id": "q3", "question": "Which traversal visits root last?", "question_type": "multiple_choice",
         "options": {"A": "Pre-order", "B": "In-order", "C": "Post-order", "D": "Level-order"},
         "correct_answer": "C", "explanation": "", "points": 10.0},
        {"question_id": "q4", "question": "What is amortized analysis?", "question_type": "short_answer",
         "options": None, "correct_answer": "Average cost over sequence of operations", "explanation": "", "points": 10.0},
        {"question_id": "q5", "question": "Explain the knapsack problem.", "question_type": "short_answer",
         "options": None, "correct_answer": "Maximize value with weight constraint", "explanation": "", "points": 10.0},
    ]),
    ("Makeup Quiz: Bonus", "Optional bonus quiz", 0.5, False, None, [
        {"question_id": "q1", "question": "What is the Turing test?", "question_type": "short_answer",
         "options": None, "correct_answer": "Test of machine intelligence", "explanation": "", "points": 10.0},
    ]),
]

# Total weight: 1+1+1+3+3+5+0.5 = 14.5
# Total max points across all: 10+10+10+50+50+50+10 = 190


# ─── Implementation ─────────────────────────────────────────────────────

async def cleanup():
    """Remove all load-test data."""
    from deeptutor.services.db import session_scope
    from deeptutor.services.db.models import (
        Assignment, Submission, Enrollment, CourseUnit, CourseUnitInstructor,
        CourseMaterial, AssignmentAccessGrant,
    )
    from sqlalchemy import delete, select
    from deeptutor.multi_user.identity import load_users, _write_users

    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit).where(CourseUnit.name == COURSE_NAME)
        )
        units = result.scalars().all()
        unit_ids = [u.id for u in units]

        if unit_ids:
            result = await session.execute(
                select(Assignment).where(Assignment.course_unit_id.in_(unit_ids))
            )
            asg_ids = [a.id for a in result.scalars().all()]
            if asg_ids:
                await session.execute(delete(Submission).where(Submission.assignment_id.in_(asg_ids)))
                await session.execute(delete(AssignmentAccessGrant).where(AssignmentAccessGrant.assignment_id.in_(asg_ids)))
            await session.execute(delete(Assignment).where(Assignment.course_unit_id.in_(unit_ids)))
            await session.execute(delete(CourseMaterial).where(CourseMaterial.course_unit_id.in_(unit_ids)))
            await session.execute(delete(Enrollment).where(Enrollment.course_unit_id.in_(unit_ids)))
            await session.execute(delete(CourseUnitInstructor).where(CourseUnitInstructor.course_unit_id.in_(unit_ids)))
            await session.execute(delete(CourseUnit).where(CourseUnit.id.in_(unit_ids)))

    # Remove load-test students
    users = load_users()
    to_remove = [k for k in users if k.startswith("load_stud_")]
    for k in to_remove:
        del users[k]
    if to_remove:
        _write_users(users)

    print(f"  Cleaned up {len(unit_ids)} course units, {len(to_remove)} students")


async def create_students():
    """Create 30 student accounts."""
    from deeptutor.services.auth import hash_password
    from deeptutor.multi_user.identity import save_user

    user_ids = {}
    for i in range(1, NUM_STUDENTS + 1):
        username = f"load_stud_{i:02d}"
        record = save_user(username, hash_password(PASSWORD), role="user")
        user_ids[username] = record["id"]
    print(f"  Created {NUM_STUDENTS} students (load_stud_01 to load_stud_{NUM_STUDENTS:02d})")
    return user_ids


async def create_course_with_assignments(user_ids, instr_a_id):
    """Create the course and all 7 assignments."""
    from deeptutor.multi_user.course_units import create_course_unit
    from deeptutor.multi_user.assignments import create_assignment, publish_assignment

    # Create course
    unit = await create_course_unit(
        name=COURSE_NAME,
        term=COURSE_TERM,
        description="Load test course with 7 assignments and 30 students",
        instructor_ids=[instr_a_id],
    )
    course_id = unit["id"]
    print(f"  Created course: {COURSE_NAME} (id={course_id[:12]}...)")

    # Create all assignments
    assignment_ids = []
    for title, desc, weight, is_major, passing_score, questions in ASSIGNMENT_DEFS:
        asg = await create_assignment(
            course_unit_id=course_id,
            title=title,
            description=desc,
            questions=questions,
            weight=weight,
            is_major=is_major,
            passing_score=passing_score,
            created_by=instr_a_id,
        )
        await publish_assignment(asg["id"])
        assignment_ids.append(asg["id"])
    print(f"  Created {len(assignment_ids)} assignments (3 quizzes, 2 tests, 1 final, 1 makeup)")
    return course_id, assignment_ids


async def enroll_all_students(course_id, user_ids):
    """Enroll all 30 students."""
    from deeptutor.multi_user.course_units import enroll_student

    for username, uid in user_ids.items():
        await enroll_student(course_id, uid)
    print(f"  Enrolled {len(user_ids)} students")


async def create_all_submissions(course_id, assignment_ids, user_ids):
    """Create submissions for every student × every assignment.
    
    Strategy: each student gets a deterministic score based on their number:
    - Student 1-10: high performers (80-100% on each)
    - Student 11-20: average (50-80%)
    - Student 21-30: low performers (20-60%)
    
    Some students skip the makeup quiz (to test partial completion).
    Students 26-30 skip the final exam (to test incomplete tracking).
    """
    from deeptutor.services.db import session_scope
    from deeptutor.services.db.models import Submission

    total_subs = 0
    for username, uid in user_ids.items():
        stud_num = int(username.split("_")[-1])
        
        for asg_idx, asg_id in enumerate(assignment_ids):
            # Students 26-30 skip the final exam (index 5)
            if stud_num >= 26 and asg_idx == 5:
                continue
            # Students 21-25 skip the makeup quiz (index 6)
            if stud_num >= 21 and stud_num <= 25 and asg_idx == 6:
                continue

            questions = ASSIGNMENT_DEFS[asg_idx][5]
            max_score = sum(q["points"] for q in questions)

            # Deterministic score based on student number and assignment
            if stud_num <= 10:
                base_pct = 0.80 + (stud_num * 0.02)  # 82% to 100%
            elif stud_num <= 20:
                base_pct = 0.50 + ((stud_num - 10) * 0.03)  # 53% to 80%
            else:
                base_pct = 0.20 + ((stud_num - 20) * 0.04)  # 24% to 60%

            # Vary slightly per assignment
            asg_factor = 1.0 - (asg_idx * 0.03)  # Later assignments slightly harder
            pct = min(1.0, max(0.0, base_pct * asg_factor))
            score = round(max_score * pct, 1)

            # Build answers and question_results
            answers = []
            question_results = []
            remaining = score
            for i, q in enumerate(questions):
                q_max = q["points"]
                if i == len(questions) - 1:
                    q_score = round(remaining, 1)
                else:
                    q_score = round(q_max * pct, 1)
                    remaining -= q_score
                q_score = max(0.0, min(q_max, q_score))
                is_correct = q_score >= q_max * 0.5
                answers.append({"question_id": q["question_id"], "answer": "simulated answer"})
                question_results.append({
                    "question_id": q["question_id"],
                    "question": q["question"],
                    "user_answer": "simulated answer",
                    "is_correct": is_correct,
                    "score": q_score,
                    "max_score": q_max,
                    "feedback": "Correct!" if is_correct else "Incorrect.",
                })

            async with session_scope() as session:
                sub = Submission(
                    assignment_id=asg_id,
                    user_id=uid,
                    answers=answers,
                    question_results=question_results,
                    score=score,
                    max_score=max_score,
                )
                session.add(sub)
            total_subs += 1

    print(f"  Created {total_subs} submissions ({len(user_ids)} students × ~7 assignments, minus skips)")


async def verify_gradebook(course_id, assignment_ids, user_ids):
    """Run the gradebook and verify correctness + performance."""
    from deeptutor.multi_user.gradebook import build_gradebook, build_gradebook_csv
    from deeptutor.multi_user.course_units import list_enrollments_for_course

    print("\n  --- Gradebook Verification ---")

    # Time the gradebook build
    t0 = time.perf_counter()
    gradebook = await build_gradebook(course_id)
    elapsed = time.perf_counter() - t0

    num_assignments = len(gradebook["assignments"])
    num_students = len(gradebook["rows"])
    print(f"  Gradebook built in {elapsed:.3f}s ({num_assignments} assignments × {num_students} students)")

    # Verify assignment summaries
    total_weight = sum(a["weight"] for a in gradebook["assignments"])
    print(f"  Total weight: {total_weight} (expected: 14.5)")
    assert total_weight == 14.5, f"Weight mismatch: {total_weight} != 14.5"

    # Check each student's final grade
    print(f"\n  Sample student grades (first 5, last 5):")
    for row in gradebook["rows"][:5] + gradebook["rows"][-5:]:
        username = row["username"]
        final = row["final_grade"]
        completed = row["completed_at"]
        scores = [pa["percentage"] for pa in row["assignments"] if pa["percentage"] is not None]
        avg = sum(scores) / len(scores) if scores else 0
        print(f"    {username}: final_grade={final:.1f}% avg={avg:.1f}% completed={'yes' if completed else 'no'}")

    # Verify completion tracking
    completed_count = sum(1 for r in gradebook["rows"] if r["completed_at"])
    incomplete_count = num_students - completed_count
    print(f"\n  Completion: {completed_count} completed, {incomplete_count} incomplete")
    print(f"  Expected: 25 completed (students 1-25), 5 incomplete (students 26-30 skipped final)")

    # Verify students 26-30 are NOT completed
    for row in gradebook["rows"]:
        stud_num = int(row["username"].split("_")[-1])
        if stud_num >= 26 and row["completed_at"]:
            print(f"  ERROR: {row['username']} should NOT be completed but is!")
        if stud_num <= 25 and not row["completed_at"]:
            print(f"  ERROR: {row['username']} should be completed but isn't!")

    # Verify final grade math for student 1
    row1 = gradebook["rows"][0]
    expected_weighted = 0.0
    expected_weight = 0.0
    for i, pa in enumerate(row1["assignments"]):
        if pa["percentage"] is not None:
            w = gradebook["assignments"][i]["weight"]
            expected_weighted += pa["percentage"] * w
            expected_weight += w
    expected_final = expected_weighted / expected_weight if expected_weight > 0 else None
    actual_final = row1["final_grade"]
    print(f"\n  Grade math check (student 1): expected={expected_final:.2f}%, actual={actual_final:.2f}%")
    assert abs(expected_final - actual_final) < 0.01, f"Grade math mismatch: {expected_final} != {actual_final}"

    # CSV export
    csv_data = await build_gradebook_csv(course_id)
    csv_lines = csv_data.strip().split("\n")
    print(f"\n  CSV export: {len(csv_lines)} lines (1 header + {num_students} rows)")
    print(f"  CSV header: {csv_lines[0][:120]}...")
    assert len(csv_lines) == num_students + 1, f"CSV row count mismatch: {len(csv_lines)} != {num_students + 1}"

    # Performance assessment
    print(f"\n  Performance: {elapsed:.3f}s for {num_assignments * num_students} submission lookups")
    queries = num_assignments * num_students
    per_query = (elapsed / queries) * 1000 if queries > 0 else 0
    print(f"  ~{per_query:.2f}ms per submission lookup (N+1 query pattern)")
    
    # Project to larger class sizes
    for proj_students in [50, 100, 200]:
        proj_queries = num_assignments * proj_students
        proj_time = proj_queries * per_query / 1000
        print(f"  Projected {proj_students} students: ~{proj_time:.1f}s ({proj_queries} lookups)")

    return elapsed, completed_count, incomplete_count


async def verify_instructor_report(instr_a_id, course_id):
    """Check the cross-course instructor report includes the load test course."""
    from deeptutor.multi_user.gradebook import build_instructor_report

    report = await build_instructor_report(instr_a_id)
    print(f"\n  --- Instructor Report ---")
    print(f"  Instructor teaches {len(report['course_units'])} course units")
    print(f"  Total students across all: {report['total_students']}")
    print(f"  Total assignments across all: {report['total_assignments']}")
    
    # Find our load test course
    load_course = None
    for cu in report["course_units"]:
        if cu["name"] == COURSE_NAME:
            load_course = cu
            break
    
    if load_course:
        print(f"  Load test course found in report: {load_course['student_count']} students, {load_course['assignment_count']} assignments")
    else:
        print(f"  ERROR: Load test course not found in instructor report!")


async def main():
    print("=" * 70)
    print("LOAD SIMULATION: 7 assignments × 30 students")
    print("=" * 70)

    # Get instr_a's user id
    from deeptutor.multi_user.identity import load_users
    users = load_users()
    instr_a = users.get("instr_a")
    if not instr_a:
        print("ERROR: instr_a not found. Run _seed.py first.")
        return
    instr_a_id = instr_a["id"]

    print("\n[1/6] Cleaning up previous load test data...")
    await cleanup()

    print("\n[2/6] Creating 30 students...")
    user_ids = await create_students()

    print("\n[3/6] Creating course + 7 assignments...")
    course_id, assignment_ids = await create_course_with_assignments(user_ids, instr_a_id)

    print("\n[4/6] Enrolling students...")
    await enroll_all_students(course_id, user_ids)

    print("\n[5/6] Creating submissions (30 students × 7 assignments, with skips)...")
    t0 = time.perf_counter()
    await create_all_submissions(course_id, assignment_ids, user_ids)
    sub_time = time.perf_counter() - t0
    print(f"  Submissions created in {sub_time:.2f}s")

    print("\n[6/6] Verifying gradebook + performance...")
    elapsed, completed, incomplete = await verify_gradebook(course_id, assignment_ids, user_ids)

    await verify_instructor_report(instr_a_id, course_id)

    print("\n" + "=" * 70)
    print("SIMULATION COMPLETE")
    print("=" * 70)
    print(f"\n  Course: {COURSE_NAME}")
    print(f"  Assignments: 7 (3 quizzes, 2 tests, 1 final, 1 makeup)")
    print(f"  Students: {NUM_STUDENTS}")
    print(f"  Submissions: ~{NUM_STUDENTS * 7 - 5 - 5} (5 skipped final, 5 skipped makeup)")
    print(f"  Gradebook build time: {elapsed:.3f}s")
    print(f"  Completion: {completed} completed, {incomplete} incomplete")
    print(f"\n  All students can log in with password: {PASSWORD}")
    print(f"  Instructor (instr_a) can view gradebook for this course")


if __name__ == "__main__":
    asyncio.run(main())
