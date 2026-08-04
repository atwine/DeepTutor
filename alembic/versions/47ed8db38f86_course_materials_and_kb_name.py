"""course materials and kb_name

Revision ID: 47ed8db38f86
Revises: 7a6894b6ba27
Create Date: 2026-08-03 12:00:00.000000

Issue #3: Course-material uploads + course-specific RAG.

* Adds a nullable ``kb_name`` column to ``course_units`` — the auto-provisioned
  KB name for the course unit (e.g. ``course_cu_abc123``). Nullable for
  backward compat with existing course units (can be provisioned later).
* Creates the ``course_materials`` table — the index/pointer for
  instructor-uploaded course materials (PDFs, notebooks, books) with a
  draft/publish workflow and an ingestion-status tracker for the background
  RAG indexing task. The physical files live in the course KB's ``raw/``
  directory; this table does not store file content.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '47ed8db38f86'
down_revision: Union[str, None] = '7a6894b6ba27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable so existing course units default to "no KB provisioned yet".
    op.add_column(
        'course_units',
        sa.Column('kb_name', sa.String(), nullable=True),
    )

    op.create_table(
        'course_materials',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('course_unit_id', sa.String(), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('file_type', sa.String(), nullable=False),
        sa.Column('file_path', sa.String(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ingestion_status', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ['course_unit_id'], ['course_units.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_course_materials_course_unit_id',
        'course_materials',
        ['course_unit_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_course_materials_course_unit_id', table_name='course_materials'
    )
    op.drop_table('course_materials')
    op.drop_column('course_units', 'kb_name')
