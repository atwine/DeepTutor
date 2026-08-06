"""add users table

Revision ID: a7e45a49a884
Revises: a1b2c3d4e5f6
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7e45a49a884'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Issue #53: replaces the JSON-file identity store (users.json) — see
    # deeptutor/services/db/models.py's User model for field-by-field notes.
    op.create_table(
        'users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('role', sa.String(), nullable=False, server_default='user'),
        sa.Column('full_name', sa.String(), nullable=False, server_default=''),
        sa.Column('registration_number', sa.String(), nullable=False, server_default=''),
        sa.Column('first_name', sa.String(), nullable=False, server_default=''),
        sa.Column('surname', sa.String(), nullable=False, server_default=''),
        sa.Column('gender', sa.String(), nullable=False, server_default=''),
        sa.Column('course', sa.String(), nullable=False, server_default=''),
        sa.Column('disabled', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('avatar', sa.String(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
    )
    op.create_index('ix_users_username', 'users', ['username'], unique=True)
    op.create_index('ix_users_role', 'users', ['role'])
    op.create_index('ix_users_registration_number', 'users', ['registration_number'])


def downgrade() -> None:
    op.drop_index('ix_users_registration_number', table_name='users')
    op.drop_index('ix_users_role', table_name='users')
    op.drop_index('ix_users_username', table_name='users')
    op.drop_table('users')
