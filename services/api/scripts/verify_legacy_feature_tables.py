"""Read-only compatibility check for feature-parity dashboard modules."""
import os
import psycopg2

expected = {"shops", "jobs", "customers", "payments", "print_jobs"}
with psycopg2.connect(os.environ["DATABASE_URL"]) as connection:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = ANY(%s)",
            (list(expected),),
        )
        present = {row[0] for row in cursor.fetchall()}

missing = expected - present
print("LEGACY_FEATURE_TABLES=" + ("PASS" if not missing else "MISSING:" + ",".join(sorted(missing))))
