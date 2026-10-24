import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import pytest

ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fixture_is_deterministic_and_solver_verified():
    generate = load_module(
        "fixture", "scripts/aws/generate-staging-fixture.py"
    ).generate
    a = generate(1800000000)
    assert a == generate(1800000000)
    assert (
        a["relationship"]["canonicalDefinitionHash"]
        != generate(1800000001)["relationship"]["canonicalDefinitionHash"]
    )
    assert a["relationship"]["earliestResolutionTimestamp"] > 1800000000
    assert a["solverRequest"]["definitionVersion"] == 1


def test_staging_fixture_rejects_tampering_and_mainnet(tmp_path):
    from eventclear_api.staging import load_fixture

    generate = load_module(
        "fixture", "scripts/aws/generate-staging-fixture.py"
    ).generate
    fixture = generate(1800000000)
    path = tmp_path / "fixture.json"
    path.write_text(json.dumps(fixture))
    settings = SimpleNamespace(
        normalized_mode="staging", chain_id=11155111, staging_fixture_path=str(path)
    )
    assert load_fixture(settings) == fixture
    settings.chain_id = 137
    with pytest.raises(RuntimeError, match="PERSISTENT_STAGING"):
        load_fixture(settings)
    settings.chain_id = 11155111
    modified = json.loads(json.dumps(fixture))
    modified["relationship"]["solverDefinition"]["validWorlds"][0][
        "payoutsAtomicByToken"
    ]["1"] = "999999"
    path.write_text(json.dumps(modified))
    with pytest.raises(RuntimeError, match="CONTENT_MISMATCH"):
        load_fixture(settings)


def test_staging_settings_require_kms_tls_access_and_test_assets(monkeypatch):
    from eventclear_api.settings import Settings

    monkeypatch.setenv("STAGING_TEST_ASSETS_ONLY", "true")
    settings = Settings(
        mode="staging",
        chain_id=11155111,
        store_backend="postgres",
        database_url="postgresql://test",
        redis_url="redis://plain",
        signer_backend="local",
    )
    monkeypatch.setattr(Settings, "_validate_manifest", lambda self: None)
    with pytest.raises(RuntimeError) as error:
        settings.validate()
    assert "REDIS_TLS_REQUIRED" in str(error.value)
    assert "STAGING_ACCESS_TOKEN" in str(error.value)
    assert "RISK_SIGNER_BACKEND=kms" in str(error.value)


def test_private_readiness_requires_solver_and_current_indexer(monkeypatch):
    import asyncio
    import time
    from datetime import datetime, timezone
    from contextlib import contextmanager
    from eventclear_api.staging import dependency_readiness
    import httpx

    row = [98, datetime.now(timezone.utc)]
    dead_letters = [0]

    class Connection:
        def execute(self, query, *args):
            self.query = query
            return self

        def fetchone(self):
            return [dead_letters[0]] if "indexer_dead_letters" in self.query else row

    class Store:
        @contextmanager
        def _connection(self):
            yield Connection()

    class Gateway:
        async def rpc(self, *args):
            return "0x64"

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, *args):
            return SimpleNamespace(status_code=200, json=lambda: {"status": "ok"})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: Client())
    settings = SimpleNamespace(
        solver_url="http://solver.private:8001", chain_id=11155111
    )
    assert asyncio.run(dependency_readiness(settings, Store(), Gateway())) == {
        "solver": True,
        "indexer": True,
    }
    row[0] = 1
    assert (
        asyncio.run(dependency_readiness(settings, Store(), Gateway()))["indexer"]
        is False
    )
    row[0] = 98
    row[1] = datetime.fromtimestamp(time.time() - 121, timezone.utc)
    assert (
        asyncio.run(dependency_readiness(settings, Store(), Gateway()))["indexer"]
        is False
    )

    row[1] = datetime.now(timezone.utc)
    dead_letters[0] = 1
    assert (
        asyncio.run(dependency_readiness(settings, Store(), Gateway()))["indexer"]
        is False
    )
