import hashlib
import os
from dataclasses import replace
from pathlib import Path

import pytest
from eth_account import Account
from eventclear_api.prototype import validate_prototype
from eventclear_api.settings import Settings
from eventclear_api.artifact_store import PostgresArtifactStore


@pytest.fixture
def prototype(monkeypatch):
    accounts = {
        role: Account.create() for role in ("DEPLOYER", "LP", "TESTER", "ADMIN", "RISK")
    }
    for key, value in {
        "TESTNET_ASSETS_ONLY": "true",
        "ENABLE_MAINNET_EXECUTION": "false",
        "PUBLIC_CAPITAL_ACTIVATED": "false",
        "PROTOTYPE_MAX_MONTHLY_COST_USD": "0",
        "SIWE_SESSION_SECRET": "s" * 48,
        "RISK_SIGNER_PRIVATE_KEY": "0x" + accounts["RISK"].key.hex(),
        **{
            f"PROTOTYPE_{role}_ADDRESS": account.address
            for role, account in accounts.items()
            if role != "RISK"
        },
    }.items():
        monkeypatch.setenv(key, value)
    return replace(
        Settings(),
        mode="testnet-prototype",
        chain_id=80002,
        store_backend="postgres",
        database_url="postgresql://example/db?sslmode=verify-full",
        redis_url="rediss://example:6379",
        solver_url="http://127.0.0.1:8001",
        admin_api_token="a" * 48,
        staging_access_token="b" * 48,
        siwe_uri="https://example.invalid",
        signer_backend="local",
        signer_key="0x" + accounts["RISK"].key.hex(),
        signer_address=accounts["RISK"].address,
        polygon_rpc_urls_raw="https://one.invalid,https://two.invalid",
        lp_allowlist_raw=accounts["LP"].address,
        tester_allowlist_raw=accounts["TESTER"].address,
        admin_allowlist_raw=accounts["ADMIN"].address,
    )


def test_valid_isolated_prototype(prototype):
    validate_prototype(prototype)


@pytest.mark.parametrize("chain_id", [1, 137, 31337, 1337, 56])
def test_rejects_mainnet_local_and_unapproved_chains(prototype, chain_id):
    with pytest.raises(RuntimeError, match="APPROVED_TESTNET_REQUIRED"):
        validate_prototype(replace(prototype, chain_id=chain_id))


@pytest.mark.parametrize(
    "variable,value",
    [
        ("TESTNET_ASSETS_ONLY", "false"),
        ("ENABLE_MAINNET_EXECUTION", "true"),
        ("PUBLIC_CAPITAL_ACTIVATED", "true"),
        ("PROTOTYPE_MAX_MONTHLY_COST_USD", "1"),
        ("SIWE_SESSION_SECRET", "short"),
    ],
)
def test_rejects_unsafe_environment(prototype, monkeypatch, variable, value):
    monkeypatch.setenv(variable, value)
    with pytest.raises(RuntimeError):
        validate_prototype(prototype)


def test_rejects_role_collision_and_development_signer(prototype, monkeypatch):
    monkeypatch.setenv("PROTOTYPE_LP_ADDRESS", prototype.signer_address)
    with pytest.raises(RuntimeError, match="SEPARATE_PROTOTYPE_ACTORS_REQUIRED"):
        validate_prototype(prototype)
    monkeypatch.setenv(
        "RISK_SIGNER_PRIVATE_KEY",
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    with pytest.raises(RuntimeError, match="DEVELOPMENT_SIGNER_PROHIBITED"):
        validate_prototype(prototype)


def test_single_rpc_requires_explicit_degraded_ack(prototype, monkeypatch):
    single = replace(prototype, polygon_rpc_urls_raw="https://one.invalid")
    with pytest.raises(RuntimeError, match="ACKNOWLEDGE_RPC_REDUNDANCY_DEGRADED"):
        validate_prototype(single)
    monkeypatch.setenv("RPC_REDUNDANCY_DEGRADED", "true")
    validate_prototype(single)


@pytest.mark.skipif(
    not os.getenv("PROTOTYPE_TEST_DATABASE_URL"),
    reason="disposable PostgreSQL required",
)
def test_real_postgres_artifact_immutability_and_tamper_detection():
    import importlib.util
    import psycopg

    url = os.environ["PROTOTYPE_TEST_DATABASE_URL"]
    spec = importlib.util.spec_from_file_location("migration", "scripts/aws/migrate.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.migrate(url, Path("infrastructure/docker/postgres/migrations"))
    assert (
        migration.migrate(url, Path("infrastructure/docker/postgres/migrations")) == []
    )
    store = PostgresArtifactStore(url)
    artifact = {"proof": "verified", "value": 1}
    stored = store.put("analysis", artifact)
    assert store.put("another-analysis", artifact) == stored
    assert store.get(stored.key, stored.sha256) == artifact
    with psycopg.connect(url) as connection:
        with pytest.raises(
            psycopg.errors.RaiseException, match="SOLVER_ARTIFACT_IMMUTABLE"
        ):
            with connection.transaction():
                connection.execute(
                    "UPDATE solver_artifact_blobs SET canonical_json=%s WHERE artifact_hash=%s",
                    (b"{}", stored.key),
                )
        # Simulate corrupt bytes under a different content address, without bypassing the trigger.
        digest = hashlib.sha256(b"wrong").hexdigest()
        connection.execute(
            "INSERT INTO solver_artifact_blobs(artifact_hash,canonical_json) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (digest, b"{}"),
        )
    with pytest.raises(RuntimeError, match="INTEGRITY_MISMATCH"):
        store.get(digest, "0x" + digest)
    conflicting = {"proof": "different"}
    from eventclear_api.artifact_store import canonical_artifact_bytes

    conflict_hash = hashlib.sha256(canonical_artifact_bytes(conflicting)).hexdigest()
    with psycopg.connect(url) as connection:
        connection.execute(
            "INSERT INTO solver_artifact_blobs(artifact_hash,canonical_json) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (conflict_hash, b"{}"),
        )
    with pytest.raises(RuntimeError, match="SOLVER_ARTIFACT_CONFLICT"):
        store.put("collision", conflicting)

    with pytest.raises(RuntimeError, match="INTEGRITY_MISMATCH"):
        store.get(stored.key, "0x" + digest)


def test_supervisor_child_failure_reaps_every_process(monkeypatch):
    import importlib.util
    import subprocess
    import sys
    import time

    spec = importlib.util.spec_from_file_location(
        "supervisor", "scripts/prototype/supervise.py"
    )
    supervisor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(supervisor)
    children = []
    original = subprocess.Popen

    def recording(*args, **kwargs):
        child = original(*args, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(subprocess, "Popen", recording)
    started = time.monotonic()
    assert (
        supervisor.supervise(
            [
                (
                    [sys.executable, "-c", "import time; time.sleep(30)"],
                    os.environ.copy(),
                ),
                ([sys.executable, "-c", "raise SystemExit(7)"], os.environ.copy()),
            ]
        )
        == 1
    )
    assert time.monotonic() - started < 5
    assert all(child.poll() is not None for child in children)
