"""Small, idempotent schema migration for the analysis-run model.

This project currently initializes PostgreSQL with ``Base.metadata.create_all``
instead of Alembic. ``create_all`` creates new tables but never adds columns to
an existing table, so the InsightRun upgrade needs an explicit compatibility
migration. The statements below are safe to execute on every application start.
"""

from sqlalchemy import text


def apply_analysis_run_migration(engine) -> None:
    statements = (
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS assessment_year INTEGER",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS requested_triggers JSONB",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS requested_insight_types JSONB",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS documents_in_scope INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS insights_matched INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS evidence_signals INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE insight_runs ADD COLUMN IF NOT EXISTS insights_reopened INTEGER NOT NULL DEFAULT 0",
        # Preserve old timestamps while clearly marking them as completed runs.
        "UPDATE insight_runs SET queued_at = COALESCE(queued_at, ran_at) WHERE queued_at IS NULL",
        "UPDATE insight_runs SET started_at = COALESCE(started_at, ran_at) WHERE started_at IS NULL",
        "UPDATE insight_runs SET completed_at = COALESCE(completed_at, ran_at) WHERE completed_at IS NULL",
        "UPDATE insight_runs SET documents_in_scope = documents_analysed WHERE documents_in_scope = 0 AND documents_analysed <> 0",
        "UPDATE insight_runs SET insights_matched = signals_found WHERE insights_matched = 0 AND signals_found <> 0",
        "ALTER TABLE insight_runs DROP CONSTRAINT IF EXISTS ck_insight_run_status",
        "ALTER TABLE insight_runs ADD CONSTRAINT ck_insight_run_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped'))",
        "ALTER TABLE insight_runs DROP CONSTRAINT IF EXISTS ck_insight_run_ya_range",
        "ALTER TABLE insight_runs ADD CONSTRAINT ck_insight_run_ya_range CHECK (assessment_year IS NULL OR (assessment_year >= 2000 AND assessment_year <= 2100))",
        "CREATE INDEX IF NOT EXISTS ix_insight_run_scope_status ON insight_runs (user_id, entity_id, assessment_year, status)",
    )

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))