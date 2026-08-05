from __future__ import annotations

import os
import time

from deeptutor.learning.models import (
    KnowledgeType,
    LearningProgress,
    RepetitionState,
    ReviewTask,
)

INTERVAL_SEQUENCES: dict[KnowledgeType, list[int]] = {
    KnowledgeType.MEMORY: [0, 1, 3, 7, 14, 30, 60],
    KnowledgeType.CONCEPT: [3, 7, 14, 30],
    KnowledgeType.PROCEDURE: [3, 7, 14],
    KnowledgeType.DESIGN: [14, 28],
}

_TYPE_PRIORITY: dict[KnowledgeType, int] = {
    KnowledgeType.MEMORY: 2,
    KnowledgeType.CONCEPT: 3,
    KnowledgeType.PROCEDURE: 4,
    KnowledgeType.DESIGN: 5,
}


class SpacedRepetitionScheduler:
    """Spaced-repetition scheduler for Mastery Path review tasks.

    Uses per-knowledge-type interval sequences to schedule the next review
    for each knowledge point and build the review queue.
    """

    def __init__(self) -> None:
        # When True, intervals are in seconds instead of days (for testing)
        self.DEBUG_MODE: bool = os.environ.get("LEARNING_DEBUG", "").lower() in ("1", "true", "yes")

    def _seconds_per_unit(self) -> float:
        return 1.0 if self.DEBUG_MODE else 86400.0

    def get_initial_state(self, knowledge_type: KnowledgeType) -> RepetitionState:
        """Create the initial repetition state for a knowledge point.

        Args:
            knowledge_type: The knowledge type whose interval sequence to use.

        Returns:
            A fresh ``RepetitionState`` with the first interval scheduled.
        """
        intervals = INTERVAL_SEQUENCES[knowledge_type]
        return RepetitionState(
            interval_index=0,
            consecutive_correct=0,
            consecutive_wrong=0,
            next_review_at=time.time() + intervals[0] * self._seconds_per_unit(),
        )

    def schedule_next(
        self, state: RepetitionState, knowledge_type: KnowledgeType, is_correct: bool
    ) -> RepetitionState:
        """Advance the repetition state after a graded answer.

        Two consecutive correct answers advance the interval by two steps;
        a wrong answer moves it back one step.

        Args:
            state: The current repetition state (mutated in place).
            knowledge_type: The knowledge type whose interval sequence to use.
            is_correct: Whether the latest answer was correct.

        Returns:
            The updated ``state`` with a new ``next_review_at`` timestamp.
        """
        intervals = INTERVAL_SEQUENCES[knowledge_type]
        max_index = len(intervals) - 1

        if is_correct:
            state.consecutive_wrong = 0
            state.consecutive_correct += 1
            if state.consecutive_correct >= 2:
                state.interval_index += 2
                state.consecutive_correct = 0
            else:
                state.interval_index += 1
        else:
            state.consecutive_wrong += 1
            state.consecutive_correct = 0
            state.interval_index = max(0, state.interval_index - 1)
            if state.consecutive_wrong >= 2:
                state.consecutive_wrong = 0

        state.interval_index = max(0, min(state.interval_index, max_index))
        state.next_review_at = (
            time.time() + intervals[state.interval_index] * self._seconds_per_unit()
        )
        return state

    def get_due_tasks(self, progress: LearningProgress, max_tasks: int = 5) -> list[ReviewTask]:
        """Return up to ``max_tasks`` due review tasks, highest priority first.

        Args:
            progress: The learner's current progress.
            max_tasks: Maximum number of tasks to return.

        Returns:
            A list of due ``ReviewTask`` objects sorted by priority.
        """
        now = time.time()
        due = [t for t in progress.review_queue if t.due_at <= now]
        due.sort(key=lambda t: t.priority)
        return due[:max_tasks]

    def build_review_queue(self, progress: LearningProgress) -> list[ReviewTask]:
        """Build the full review queue from all tracked repetition states.

        Knowledge points with active errors get the highest priority (1);
        others are prioritized by knowledge type.

        Args:
            progress: The learner's current progress.

        Returns:
            A list of ``ReviewTask`` objects, one per tracked knowledge point.
        """
        tasks: list[ReviewTask] = []
        error_kps: set[str] = set()
        for rec in progress.error_records:
            if rec.status in ("active", "retrying"):
                error_kps.add(rec.knowledge_point_id)

        for kp_id, state in progress.repetition_states.items():
            kp_type = progress.knowledge_types.get(kp_id, KnowledgeType.MEMORY)
            priority = 1 if kp_id in error_kps else _TYPE_PRIORITY[kp_type]
            tasks.append(
                ReviewTask(
                    id=f"review_{kp_id}",
                    knowledge_point_id=kp_id,
                    knowledge_type=kp_type,
                    due_at=state.next_review_at,
                    priority=priority,
                    state=state,
                )
            )
        return tasks


__all__ = ["SpacedRepetitionScheduler", "INTERVAL_SEQUENCES"]
