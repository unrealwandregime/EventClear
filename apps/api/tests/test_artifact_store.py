from __future__ import annotations

import io

import pytest

from eventclear_api.artifact_store import S3ArtifactStore


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict] = {}

    def put_object(self, **kwargs):
        target = (kwargs["Bucket"], kwargs["Key"])
        if target in self.objects and kwargs.get("IfNoneMatch") == "*":
            raise RuntimeError("PRECONDITION_FAILED")
        self.objects[target] = {
            "body": bytes(kwargs["Body"]),
            "metadata": dict(kwargs["Metadata"]),
            "encryption": kwargs["ServerSideEncryption"],
        }

    def get_object(self, *, Bucket: str, Key: str):
        stored = self.objects[(Bucket, Key)]
        return {
            "Body": io.BytesIO(stored["body"]),
            "Metadata": stored["metadata"],
        }


def test_artifact_round_trip_is_immutable_encrypted_and_hash_verified():
    client = FakeS3()
    store = S3ArtifactStore(bucket="private", region="test", client=client)
    artifact = {"request": {"value": 1}, "result": {"eligible": True}}

    stored = store.put("analysis-1", artifact)

    assert stored.key.startswith("analyses/analysis-1/")
    assert stored.sha256.startswith("0x")
    assert client.objects[("private", stored.key)]["encryption"] == "AES256"
    assert store.get(stored.key, stored.sha256) == artifact
    with pytest.raises(RuntimeError, match="PRECONDITION_FAILED"):
        store.put("analysis-1", artifact)


def test_artifact_tampering_fails_closed():
    client = FakeS3()
    store = S3ArtifactStore(bucket="private", region="test", client=client)
    stored = store.put("analysis-2", {"proof": "valid"})
    client.objects[("private", stored.key)]["body"] = b'{"proof":"changed"}'

    with pytest.raises(RuntimeError, match="SOLVER_ARTIFACT_INTEGRITY_MISMATCH"):
        store.get(stored.key, stored.sha256)
