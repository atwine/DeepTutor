"""enrollment completed_at

Revision ID: 7a6894b6ba27
Revises: 65b81544bdc8
Create Date: 2026-08-03 00:00:00.000000

Issue #4: Course completion tracking — adds a nullable ``completed_at``
timestamp to ``enrollments``. Set automatically when a student has
submitted+graded every published assignment for the unit (see
``course_units.py:check_and_mark_completion``). Nullable so existing
enrollments default to "not completed"; completion is additive and never
revokes read access to course materials.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '7a6894b6ba27'
down_revision: Union[str, None] = '65b81544bdc8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'enrollments',
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('enrollments', 'completed_at')
