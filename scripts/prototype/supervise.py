"""One-container prototype supervisor. Any child failure stops the deployment."""

import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def run():
    if os.getenv("EVENTCLEAR_MODE") != "testnet-prototype":
        raise RuntimeError("PROTOTYPE_MODE_REQUIRED")
    if any(
        "PRIVATE_KEY" in key and key != "RISK_SIGNER_PRIVATE_KEY" for key in os.environ
    ):
        raise RuntimeError("ONLY_RISK_KEY_BELONGS_ON_HOST")
    # These are public metadata, never wallet keys. Provider secrets stay in env.
    for variable, target in (
        ("PROTOTYPE_MANIFEST_JSON", "/tmp/prototype-manifest.json"),
        ("PROTOTYPE_FIXTURE_JSON", "/tmp/prototype-fixture.json"),
    ):
        value = json.loads(os.environ.pop(variable))
        Path(target).write_text(json.dumps(value))
    os.environ["CONTRACT_MANIFEST_PATH"] = "/tmp/prototype-manifest.json"
    os.environ["STAGING_FIXTURE_PATH"] = "/tmp/prototype-fixture.json"
    manifest = json.loads(Path("/tmp/prototype-manifest.json").read_text())
    for variable, contract in {
        "VAULT_ADDRESS": "vault",
        "FUNDING_POOL_ADDRESS": "fundingPool",
        "COLLATERAL_TOKEN_ADDRESS": "collateralToken",
        "CTF_ADDRESS": "conditionalTokens",
        "STANDARD_CTF_ADAPTER_ADDRESS": "standardAdapter",
        "RISK_POLICY_ADDRESS": "riskPolicy",
        "RELATIONSHIP_REGISTRY_ADDRESS": "relationshipRegistry",
        "CLAIMS_ADDRESS": "claims",
        "TREASURY_ADDRESS": "treasury",
    }.items():
        os.environ[variable] = manifest["contracts"][contract]["address"]
    for role in ("LP", "TESTER", "ADMIN"):
        os.environ[f"{role}_ALLOWLIST"] = os.environ[f"PROTOTYPE_{role}_ADDRESS"]
    os.environ["CONTRACTS_DEPLOYED"] = "true"

    from eventclear_api.settings import Settings

    Settings().validate()
    spec = importlib.util.spec_from_file_location(
        "migration", "/app/scripts/aws/migrate.py"
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.migrate(os.environ["DATABASE_URL"], Path("/app/migrations"))
    subprocess.run([sys.executable, "scripts/prototype/preflight.py"], check=True)
    base = os.environ.copy()
    # Only the API needs the risk key; no other actor key belongs on the host.
    public_env = {
        key: value
        for key, value in base.items()
        if "PRIVATE_KEY" not in key
        and key not in {"ADMIN_API_TOKEN", "SIWE_SESSION_SECRET"}
    }
    commands = [
        (
            [
                sys.executable,
                "-m",
                "uvicorn",
                "eventclear_solver.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8001",
                "--no-access-log",
            ],
            public_env,
        ),
        (
            [
                sys.executable,
                "-m",
                "uvicorn",
                "eventclear_api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
                "--no-access-log",
            ],
            base,
        ),
        (["node", "--import", "tsx", "apps/indexer/src/index.ts", "run"], public_env),
        (
            ["node", "node_modules/vinext/dist/cli.js", "start", "--port", "3000"],
            public_env,
        ),
        (["node", "scripts/prototype/gateway.mjs"], public_env),
    ]
    return supervise(commands)


def supervise(commands):
    children = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True
        for child in children:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        for command, env in commands:
            children.append(subprocess.Popen(command, env=env, start_new_session=True))
        print(
            json.dumps({"event": "prototype_children_started", "count": len(children)}),
            flush=True,
        )
        while not stopping:
            for index, child in enumerate(children):
                if child.poll() is not None:
                    print(
                        json.dumps(
                            {
                                "event": "child_exit",
                                "child": index,
                                "code": child.returncode,
                            }
                        ),
                        flush=True,
                    )
                    stop()
                    return 1
            time.sleep(0.5)
        return 0
    finally:
        stop()
        deadline = time.monotonic() + 20
        for child in children:
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception:
        print(
            '{"event":"prototype_startup_failed","detail":"CHECK_CONFIGURATION_AND_DEPENDENCIES"}',
            flush=True,
        )
        sys.exit(1)
