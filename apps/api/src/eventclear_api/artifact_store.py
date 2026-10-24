from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


def canonical_artifact_bytes(artifact: dict[str, Any]) -> bytes:
    return json.dumps(
        artifact,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()


@dataclass(frozen=True)
class StoredArtifact:
    key: str
    sha256: str


class S3ArtifactStore:
    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        endpoint_url: str = "",
        access_key_id: str = "",
        secret_access_key: str = "",
        client: Any | None = None,
    ) -> None:
        self.bucket = bucket
        if client is not None:
            self.client = client
            return

        import boto3

        credentials: dict[str, str] = {}
        if access_key_id and secret_access_key:
            credentials = {
                "aws_access_key_id": access_key_id,
                "aws_secret_access_key": secret_access_key,
            }
        self.client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint_url or None,
            **credentials,
        )

    def put(self, analysis_id: str, artifact: dict[str, Any]) -> StoredArtifact:
        body = canonical_artifact_bytes(artifact)
        digest = hashlib.sha256(body).hexdigest()
        key = f"analyses/{analysis_id}/{digest}.json"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
            Metadata={"sha256": digest},
            ServerSideEncryption="AES256",
            IfNoneMatch="*",
        )
        return StoredArtifact(key=key, sha256=f"0x{digest}")

    def get(self, key: str, expected_sha256: str) -> dict[str, Any]:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        body = response["Body"].read()
        actual = hashlib.sha256(body).hexdigest()
        expected = expected_sha256.removeprefix("0x").lower()
        metadata_digest = str(response.get("Metadata", {}).get("sha256", "")).lower()
        if actual != expected or metadata_digest != expected:
            raise RuntimeError("SOLVER_ARTIFACT_INTEGRITY_MISMATCH")
        try:
            value = json.loads(body)
        except json.JSONDecodeError as exc:
            raise RuntimeError("SOLVER_ARTIFACT_INVALID_JSON") from exc
        if not isinstance(value, dict):
            raise RuntimeError("SOLVER_ARTIFACT_INVALID")
        return value


def create_artifact_store(
    settings: Any,
) -> S3ArtifactStore | PostgresArtifactStore | None:
    if settings.normalized_mode == "testnet-prototype":
        return PostgresArtifactStore(settings.database_url)
    if settings.normalized_mode != "staging":
        return None
    return S3ArtifactStore(
        bucket=settings.object_storage_bucket,
        region=settings.object_storage_region,
        endpoint_url=settings.object_storage_endpoint,
        access_key_id=settings.object_storage_access_key,
        secret_access_key=settings.object_storage_secret_key,
    )


class PostgresArtifactStore:
    """Content-addressed, create-once artifacts; JSON bytes remain authoritative."""

    def __init__(self, database_url: str):
        self.database_url = database_url

    def put(self, analysis_id: str, artifact: dict[str, Any]) -> StoredArtifact:
        import psycopg

        body = canonical_artifact_bytes(artifact)
        digest = hashlib.sha256(body).hexdigest()
        with psycopg.connect(self.database_url) as connection:
            connection.execute(
                "INSERT INTO solver_artifact_blobs(artifact_hash,canonical_json) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (digest, body),
            )
            existing = connection.execute(
                "SELECT canonical_json FROM solver_artifact_blobs WHERE artifact_hash=%s",
                (digest,),
            ).fetchone()
            if existing is None or bytes(existing[0]) != body:
                raise RuntimeError("SOLVER_ARTIFACT_CONFLICT")
        return StoredArtifact(key=digest, sha256=f"0x{digest}")

    def get(self, key: str, expected_sha256: str) -> dict[str, Any]:
        import psycopg

        expected = expected_sha256.removeprefix("0x").lower()
        if key != expected:
            raise RuntimeError("SOLVER_ARTIFACT_INTEGRITY_MISMATCH")
        with psycopg.connect(self.database_url) as connection:
            row = connection.execute(
                "SELECT canonical_json FROM solver_artifact_blobs WHERE artifact_hash=%s",
                (key,),
            ).fetchone()
        if row is None:
            raise RuntimeError("SOLVER_ARTIFACT_NOT_FOUND")
        body = bytes(row[0])
        if hashlib.sha256(body).hexdigest() != expected:
            raise RuntimeError("SOLVER_ARTIFACT_INTEGRITY_MISMATCH")
        value = json.loads(body)
        if not isinstance(value, dict) or canonical_artifact_bytes(value) != body:
            raise RuntimeError("SOLVER_ARTIFACT_INVALID")
        return value
