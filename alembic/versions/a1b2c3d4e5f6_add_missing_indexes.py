"""add missing indexes for scalability (issue #38)

Revision ID: a1b2c3d4e5f6
Revises: c5ec8bcbe188
Create Date: 2026-08-04 22:00:00.000000

Adds indexes that are missing on several tables. These columns are
frequently filtered/joined on but had no index, causing full table
scans at 100x scale. Also adds a composite (assignment_id, user_id)
index on submissions for queries that filter by both columns.

See devin-handoff/SCALABILITY_AUDIT.md (Tier 1, items T1.3-T1.5) for
the full rationale.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c5ec8bcbe188'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Issue #38: Composite index on submissions for queries that filter
    # by both assignment_id AND user_id (get_latest_submission,
    # count_submissions, get_latest_submissions_batch). The existing
    # single-column indexes help individual filters but can't be
    # combined efficiently by the planner for AND queries.
    op.create_index(
        'ix_submissions_assignment_user',
        'submissions',
        ['assignment_id', 'user_id'],
        unique=False,
    )

    # Issue #38: Index on submissions.submitted_at — used in ORDER BY
    # for latest-submission queries.
    op.create_index(
        'ix_submissions_submitted_at',
        'submissions',
        ['submitted_at'],
        unique=False,
    )

    # Issue #38: Indexes on enrollments — both columns are filtered on
    # in every roster, enrollment, and completion check query.
    op.create_index(
        'ix_enrollments_course_unit_id',
        'enrollments',
        ['course_unit_id'],
        unique=False,
    )
    op.create_index(
        'ix_enrollments_user_id',
        'enrollments',
        ['user_id'],
        unique=False,
    )

    # Issue #38: Index on notifications.course_unit_id — filtered on
    # in list_notifications_for_user() IN clause.
    op.create_index(
        'ix_notifications_course_unit_id',
        'notifications',
        ['course_unit_id'],
        unique=False,
    )

    # Issue #38: Indexes on notification_reads — both columns are
    # filtered on in list_notifications_for_user() read-status check.
    op.create_index(
        'ix_notification_reads_notification_id',
        'notification_reads',
        ['notification_id'],
        unique=False,
    )
    op.create_index(
        'ix_notification_reads_user_id',
        'notification_reads',
        ['user_id'],
        unique=False,
    )

    # Issue #38: Index on course_book_entries.course_unit_id — filtered
    # on in course book queries.
    op.create_index(
        'ix_course_book_entries_course_unit_id',
        'course_book_entries',
        ['course_unit_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_course_book_entries_course_unit_id', table_name='course_book_entries')
    op.drop_index('ix_notification_reads_user_id', table_name='notification_reads')
    op.drop_index('ix_notification_reads_notification_id', table_name='notification_reads')
    op.drop_index('ix_notifications_course_unit_id', table_name='notifications')
    op.drop_index('ix_enrollments_user_id', table_name='enrollments')
    op.drop_index('ix_enrollments_course_unit_id', table_name='enrollments')
    op.drop_index('ix_submissions_submitted_at', table_name='submissions')
    op.drop_index('ix_submissions_assignment_user', table_name='submissions')
