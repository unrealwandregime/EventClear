from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from typing import Iterator

import psycopg

from .seed import MARKETS, RELATIONSHIPS, MemoryStore
from .settings import Settings


class PostgresStore:
    """Durable API read model and security state.

    The normalized protocol tables remain the accounting source of truth. This
    store is a CQRS read model for API payloads plus atomic operational state.
    """

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.database_url) as connection:
            yield connection

    def initialize(self, seed_demo_data: bool) -> None:
        with self._connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT value FROM api_counters WHERE name = 'quote_nonce'")
                if cursor.fetchone() is None:
                    raise RuntimeError("QUOTE_NONCE_COUNTER_MISSING")
                if not seed_demo_data:
                    return
                for market in MARKETS:
                    cursor.execute(
                        """
                        INSERT INTO api_read_models(kind, key, payload)
                        VALUES ('market', %s, %s::jsonb)
                        ON CONFLICT (kind, key) DO NOTHING
                        """,
                        (market["conditionId"], json.dumps(market)),
                    )
                for relationship in RELATIONSHIPS:
                    cursor.execute(
                        """
                        INSERT INTO api_read_models(kind, key, payload)
                        VALUES ('relationship', %s, %s::jsonb)
                        ON CONFLICT (kind, key) DO NOTHING
                        """,
                        (relationship["id"], json.dumps(relationship)),
                    )
                cursor.execute(
                    """
                    INSERT INTO api_read_models(kind, key, payload)
                    VALUES ('bundle', 'EC-00418', %s::jsonb)
                    ON CONFLICT (kind, key) DO NOTHING
                    """,
                    (
                        json.dumps(
                            {
                                "id": "EC-00418",
                                "status": "ACTIVE",
                                "principalAmountAtomic": "100000000",
                                "advanceAmountAtomic": "93500000",
                            }
                        ),
                    ),
                )

    def reset(self) -> None:
        raise RuntimeError("RESET_NOT_SUPPORTED_FOR_POSTGRES")

    @staticmethod
    def _digest(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    def create_siwe_nonce(self, nonce: str, expires_at: float) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO auth_nonces(nonce_hash, expires_at)
                VALUES (%s, to_timestamp(%s))
                """,
                (self._digest(nonce), expires_at),
            )

    def consume_siwe_nonce(self, nonce: str, now: float) -> bool:
        with self._connection() as connection:
            row = connection.execute(
                """
                UPDATE auth_nonces
                SET used_at = to_timestamp(%s)
                WHERE nonce_hash = %s AND used_at IS NULL AND expires_at >= to_timestamp(%s)
                RETURNING nonce_hash
                """,
                (now, self._digest(nonce), now),
            ).fetchone()
            return row is not None

    def create_session(self, token: str, address: str, expires_at: float) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO auth_sessions(token_hash, address, expires_at)
                VALUES (%s, %s, to_timestamp(%s))
                """,
                (self._digest(token), address, expires_at),
            )

    def _list(self, kind: str) -> list[dict]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM api_read_models WHERE kind = %s ORDER BY key",
                (kind,),
            ).fetchall()
        return [deepcopy(row[0]) for row in rows]

    def _get(self, kind: str, key: str) -> dict | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT payload FROM api_read_models WHERE kind = %s AND key = %s",
                (kind, key),
            ).fetchone()
        return deepcopy(row[0]) if row else None

    def _put(self, kind: str, key: str, value: dict) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO api_read_models(kind, key, payload, updated_at)
                VALUES (%s, %s, %s::jsonb, now())
                ON CONFLICT (kind, key)
                DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
                """,
                (kind, key, json.dumps(value)),
            )

    def list_markets(self) -> list[dict]:
        return self._list("market")

    def get_market(self, condition_id: str) -> dict | None:
        return self._get("market", condition_id)

    def list_relationships(self) -> list[dict]:
        return self._list("relationship")

    def get_relationship(self, relationship_id: str) -> dict | None:
        return self._get("relationship", relationship_id)

    def get_relationship_by_hash(self, definition_hash: str) -> dict | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT payload FROM api_read_models
                WHERE kind = 'relationship'
                  AND payload->>'canonicalDefinitionHash' = %s
                LIMIT 1
                """,
                (definition_hash,),
            ).fetchone()
        return deepcopy(row[0]) if row else None

    def create_relationship(self, item: dict) -> dict:
        if self.get_relationship(item["id"]) is not None:
            raise ValueError("RELATIONSHIP_ALREADY_EXISTS")
        self._put("relationship", item["id"], item)
        return deepcopy(item)

    def set_relationship_status(self, relationship_id: str, status: str) -> dict | None:
        item = self.get_relationship(relationship_id)
        if item is None:
            return None
        item["status"] = status
        self._put("relationship", relationship_id, item)
        return item

    def allocate_quote_nonce(self) -> int:
        with self._connection() as connection:
            row = connection.execute(
                """
                UPDATE api_counters SET value = value + 1
                WHERE name = 'quote_nonce'
                RETURNING value - 1
                """
            ).fetchone()
            if row is None:
                raise RuntimeError("QUOTE_NONCE_COUNTER_MISSING")
            return int(row[0])

    def save_quote(self, quote_id: str, value: dict) -> None:
        self._put("quote", quote_id, value)

    def get_quote(self, quote_id: str) -> dict | None:
        return self._get("quote", quote_id)

    def list_bundles(self) -> list[dict]:
        return self._list("bundle")

    def get_bundle(self, bundle_id: str) -> dict | None:
        return self._get("bundle", bundle_id)

    def append_audit_log(self, entry: dict) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO audit_logs(actor, action, target_type, target_id, metadata)
                VALUES (%s, %s, %s, %s, %s::jsonb)
                """,
                (
                    entry["actor"],
                    entry["action"],
                    entry.get("targetType", "relationship"),
                    entry.get("target") or "unknown",
                    json.dumps(
                        {
                            **entry.get("metadata", {}),
                            "recordedAt": datetime.now(timezone.utc).isoformat(),
                        }
                    ),
                ),
            )


def create_store(settings: Settings) -> MemoryStore | PostgresStore:
    if settings.store_backend == "memory":
        return MemoryStore()
    if settings.store_backend != "postgres":
        raise RuntimeError("INVALID_STORE_BACKEND")
    store = PostgresStore(settings.database_url)
    store.initialize(seed_demo_data=settings.mode != "polygon-mainnet")
    return store
