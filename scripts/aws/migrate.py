"""Apply checksum-pinned migrations once under a PostgreSQL advisory lock."""

import hashlib
import os
from pathlib import Path
import psycopg


def migrate(url: str, directory: Path) -> list[str]:
    applied = []
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute("SELECT pg_advisory_lock(138109317)")
        try:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS eventclear_schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            for path in sorted(directory.glob("*.sql")):
                sql = path.read_text()
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                existing = connection.execute(
                    "SELECT sha256 FROM eventclear_schema_migrations WHERE name=%s",
                    (path.name,),
                ).fetchone()
                if existing:
                    if existing[0] != digest:
                        raise RuntimeError(f"MIGRATION_CHECKSUM_CHANGED:{path.name}")
                    continue
                # Repository migrations wrap themselves in BEGIN/COMMIT. Use one
                # outer transaction so DDL and the ledger commit atomically.
                statements = (
                    sql.strip().removeprefix("BEGIN;").strip().removesuffix("COMMIT;")
                )
                with connection.transaction():
                    connection.execute(statements)
                    connection.execute(
                        "INSERT INTO eventclear_schema_migrations(name, sha256) VALUES (%s,%s)",
                        (path.name, digest),
                    )
                applied.append(path.name)
        finally:
            connection.execute("SELECT pg_advisory_unlock(138109317)")
    return applied


if __name__ == "__main__":
    print(
        "Applied migrations:",
        ",".join(
            migrate(
                os.environ["DATABASE_URL"],
                Path(os.environ.get("MIGRATIONS_DIR", "/migrations")),
            )
        )
        or "none",
    )
