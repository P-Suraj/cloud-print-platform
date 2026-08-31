#!/usr/bin/env python3
"""
AutoPrint v3 Migration Runner
Connects to DATABASE_URL, runs migrations in order, records results
in a public.schema_migrations table.

Usage:
  python run_migrations.py                     # Run all pending migrations
  python run_migrations.py --target 0006       # Run up to and including 0006
  python run_migrations.py --rollback          # Run migration 0008 (rollback)
  python run_migrations.py --status            # Print applied migrations

Environment:
  DATABASE_URL   PostgreSQL connection string (required)
"""

import os
import sys
import argparse
import glob
import re
from pathlib import Path

# psycopg2 is the standard PostgreSQL adapter; supabase-py does not support
# raw DDL/multi-statement SQL execution.
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[ERROR] psycopg2 is required: pip install psycopg2-binary")
    sys.exit(1)

MIGRATIONS_DIR = Path(__file__).parent
MIGRATIONS_TABLE = "public.schema_migrations"

# Ordered forward migrations. Migration 0008 is the explicit rollback.
FORWARD_MIGRATIONS = [
    "0000_preflight_inventory.sql",
    "0001_v3_types_and_core.sql",
    "0002_v3_constraints_indexes.sql",
    "0003_v3_roles_grants_rls.sql",
    "0004_v3_canary_backfill.sql",
    "0005_v3_state_machine.sql",
    "0006_v3_transaction_functions.sql",
    "0007_v3_canary_cutover.sql",
    "0009_v3_postgrest_exposure.sql",
    "0010_v3_postgrest_schema_reload.sql",
    "0011_v3_crypto_search_path.sql",
    "0012_fix_claim_transition_validation.sql",
    "0013_phase1_order_entry_channel.sql",
    "0014_phase1_remote_order_policy.sql",
    "0015_phase2_atomic_customer_cancellation.sql",
    "0016_phase3_pickup_lifecycle.sql",
    # 0019 depends only on the Phase 3 schema and must not be blocked by the
    # later, independently-reviewed Phase 4/5 migrations.
    "0019_phase3_pickup_transition_and_rate_limit_hardening.sql",
    "0017_phase4_shop_discovery.sql",
    "0020_phase4_discovery_safety_hardening.sql",
    "0018_phase5_queue_estimates.sql",
    "0021_optional_customer_job_name.sql",
    "0022_shop_print_option_overrides.sql",
    "0023_batch_quote_items.sql",
    "0024_complete_batch_quote_pipeline.sql",
    "0025_fix_preparation_task_claim_column_ambiguity.sql",
]

ROLLBACK_MIGRATION = "0008_v3_canary_rollback.sql"


def _get_connection():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[ERROR] DATABASE_URL environment variable is not set")
        sys.exit(1)
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        return conn
    except Exception as exc:
        print(f"[ERROR] Could not connect to database: {exc}")
        sys.exit(1)


def _ensure_migrations_table(conn):
    """Create the schema_migrations tracking table if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {MIGRATIONS_TABLE} (
                migration_id  text        PRIMARY KEY,
                applied_at    timestamptz NOT NULL DEFAULT now(),
                direction     text        NOT NULL DEFAULT 'up',
                checksum      text
            );
        """)
    conn.commit()


def _get_applied(conn) -> set:
    """Return set of migration_ids that have been applied (direction='up')."""
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT migration_id FROM {MIGRATIONS_TABLE} WHERE direction = 'up'"
        )
        return {row[0] for row in cur.fetchall()}


def _run_migration(conn, migration_file: str):
    """Execute a single migration SQL file inside a transaction."""
    path = MIGRATIONS_DIR / migration_file
    if not path.exists():
        print(f"[ERROR] Migration file not found: {path}")
        sys.exit(1)

    sql = path.read_text(encoding="utf-8")
    migration_id = path.stem

    import hashlib
    checksum = hashlib.sha256(sql.encode()).hexdigest()[:12]

    print(f"  Running: {migration_file} (checksum={checksum})...", end=" ", flush=True)
    try:
        with conn.cursor() as cur:
            if migration_file == "0004_v3_canary_backfill.sql":
                owner_email = os.environ.get("CANARY_OWNER_EMAIL", "").strip().lower()
                if not owner_email:
                    raise RuntimeError("CANARY_OWNER_EMAIL is required for migration 0004")
                cur.execute(
                    "SELECT set_config('autoprint.canary_owner_email', %s, true)",
                    (owner_email,),
                )
            # Migration files are also directly executable with psql and carry
            # an outer BEGIN/COMMIT wrapper. Strip only that wrapper here so
            # the schema change and tracking row share this runner transaction.
            runner_sql = re.sub(r"^\s*BEGIN\s*;", "", sql, count=1, flags=re.IGNORECASE)
            runner_sql = re.sub(r"COMMIT\s*;\s*$", "", runner_sql, count=1, flags=re.IGNORECASE)
            cur.execute(runner_sql)
            # Record in tracking table (within same transaction)
            direction = "down" if "rollback" in migration_id.lower() else "up"
            if direction == "down":
                cur.execute(
                    f"DELETE FROM {MIGRATIONS_TABLE} WHERE migration_id = %s AND direction = 'up'",
                    ("0007_v3_canary_cutover",),
                )
            cur.execute(
                f"INSERT INTO {MIGRATIONS_TABLE} (migration_id, direction, checksum) "
                f"VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (migration_id, direction, checksum)
            )
        conn.commit()
        print("OK")
    except Exception as exc:
        conn.rollback()
        print(f"FAILED\n[ERROR] {exc}")
        sys.exit(1)


def cmd_status(conn):
    applied = _get_applied(conn)
    print("\nMigration Status:")
    print("-" * 50)
    for mf in FORWARD_MIGRATIONS:
        mid = Path(mf).stem
        status = "✅ applied" if mid in applied else "⬜ pending"
        print(f"  {status}  {mf}")
    print("-" * 50)


def cmd_run(conn, target: str = None):
    applied = _get_applied(conn)
    migrations = FORWARD_MIGRATIONS

    if target:
        # Find the index of the target migration prefix
        filtered = [m for m in migrations if m.startswith(target)]
        if not filtered:
            print(f"[ERROR] No migration matching prefix '{target}'")
            sys.exit(1)
        target_idx = migrations.index(filtered[0])
        migrations = migrations[: target_idx + 1]

    pending = [m for m in migrations if Path(m).stem not in applied]
    if not pending:
        print("[INFO] No pending migrations — database is up to date.")
        return

    print(f"\nRunning {len(pending)} pending migration(s):")
    for mf in pending:
        _run_migration(conn, mf)

    print("\n[DONE] All migrations applied successfully.")


def cmd_rollback(conn):
    print(f"\n[ROLLBACK] Running {ROLLBACK_MIGRATION}...")
    _run_migration(conn, ROLLBACK_MIGRATION)
    print("[DONE] Rollback complete.")


def main():
    parser = argparse.ArgumentParser(description="AutoPrint v3 Migration Runner")
    parser.add_argument("--target",   type=str,          help="Run up to migration with this prefix (e.g. 0006)")
    parser.add_argument("--rollback", action="store_true", help="Run rollback migration 0008")
    parser.add_argument("--status",   action="store_true", help="Print migration status")
    args = parser.parse_args()

    conn = _get_connection()
    _ensure_migrations_table(conn)

    if args.status:
        cmd_status(conn)
    elif args.rollback:
        cmd_rollback(conn)
    else:
        cmd_run(conn, target=args.target)

    conn.close()


if __name__ == "__main__":
    main()
