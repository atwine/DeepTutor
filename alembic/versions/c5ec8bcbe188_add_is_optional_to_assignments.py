"""add is_optional to assignments

Revision ID: c5ec8bcbe188
Revises: 47ed8db38f86
Create Date: 2026-08-04 12:16:11.730371

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5ec8bcbe188'
down_revision: Union[str, None] = '47ed8db38f86'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Issue #32: Add is_optional column to assignments table.
    # Defaults to False — all existing assignments are required (preserving
    # current completion-tracking behavior). New optional/bonus assignments
    # can be created with is_optional=True to exclude them from the
    # completion check.
    op.add_column(
        'assignments',
        sa.Column('is_optional', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    op.drop_column('assignments', 'is_optional')
