"""Expose public vulnerability diagnostics through checks; never hide scanner errors."""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


def clean(value):
    text = re.sub(
        r"https?://\S+",
        lambda match: urlsplit(match.group()).hostname or "[URL]",
        str(value),
    )
    return re.sub(r"[^a-zA-Z0-9_@./,: +()=-]", "_", text)


def summarize(directory):
    findings = []
    statuses = json.loads((directory / "scan-exit-status.json").read_text())
    for service in ["web", "api", "solver", "indexer", "migration", "prototype"]:
        path = directory / f"{service}.json"
        vulnerabilities = []
        if path.exists():
            report = json.loads(path.read_text())
            vulnerabilities = [
                item
                for result in report.get("Results", [])
                for item in result.get("Vulnerabilities", [])
                if item.get("Severity") == "CRITICAL"
            ]
        for item in vulnerabilities:
            detail = clean(
                f"{service}:{item['PkgName']}:{item['VulnerabilityID']}:fixed={item.get('FixedVersion', 'unavailable')}"
            )
            findings.append(detail)
            print(f"::error title=Critical runtime vulnerability::{detail}")
        if not path.exists() or (statuses.get(service, 1) != 0 and not vulnerabilities):
            error_file = directory / f"{service}.stderr"
            errors = (
                error_file.read_text() if error_file.exists() else "no scanner report"
            )
            lines = [
                line
                for line in errors.splitlines()
                if any(
                    word in line.lower()
                    for word in ["fatal", "error", "denied", "version"]
                )
            ]
            detail = clean(f"{service}:SCANNER_ERROR:{' '.join(lines[-2:])}")[:400]
            findings.append(detail)
            print(f"::error title=Runtime scanner failure::{detail}")
    summary = (
        "; ".join(findings) if findings else "all six images: zero critical findings"
    )
    if os.getenv("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"critical_findings={summary[:210]}\n")
    print(summary)
    return bool(findings)


if __name__ == "__main__":
    sys.exit(summarize(Path(sys.argv[1])))
