"""Materialize public deployment metadata only, then start the staging API."""

import json
import os
from pathlib import Path

if os.environ.get("EVENTCLEAR_MODE") != "staging":
    raise RuntimeError("STAGING_MODE_REQUIRED")
for name, path in [
    ("STAGING_MANIFEST_JSON", "/tmp/staging-manifest.json"),
    ("STAGING_FIXTURE_JSON", "/tmp/staging-fixture.json"),
]:
    data = json.loads(os.environ.pop(name))
    Path(path).write_text(json.dumps(data))
os.environ["CONTRACT_MANIFEST_PATH"] = "/tmp/staging-manifest.json"
os.environ["STAGING_FIXTURE_PATH"] = "/tmp/staging-fixture.json"
os.execvp(
    "uvicorn",
    ["uvicorn", "eventclear_api.main:app", "--host", "0.0.0.0", "--port", "8000"],
)
