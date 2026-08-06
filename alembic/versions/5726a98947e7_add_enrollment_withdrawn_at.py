"""add enrollment withdrawn_at

Revision ID: 5726a98947e7
Revises: a7e45a49a884
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5726a98947e7'
down_revision: Union[str, None] = 'a7e45a49a884'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Unenrolling a student used to hard-delete the Enrollment row, losing
    # all history. It now moves the row to status='withdrawn' and stamps
    # this column instead (see course_units.py's unenroll_student /
    # approve_leave), so completion/dropout numbers survive a student
    # leaving a course.
    op.add_column(
        'enrollments',
        sa.Column('withdrawn_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('enrollments', 'withdrawn_at')
