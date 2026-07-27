from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import solve, verify_artifact
from .models import ProofArtifact, SolverRequest


def main() -> None:
    parser = argparse.ArgumentParser(prog="eventclear-solver")
    commands = parser.add_subparsers(dest="command", required=True)
    solve_parser = commands.add_parser("solve")
    solve_parser.add_argument("request")
    solve_parser.add_argument("--out", required=True)
    verify_parser = commands.add_parser("verify")
    verify_parser.add_argument("proof")
    args = parser.parse_args()
    if args.command == "solve":
        request = SolverRequest.model_validate_json(Path(args.request).read_text(encoding="utf-8"))
        artifact = ProofArtifact(request=request, result=solve(request))
        Path(args.out).write_text(json.dumps(artifact.model_dump(mode="json"), indent=2), encoding="utf-8")
        print(artifact.result.proofArtifactHash)
        return
    if not verify_artifact(args.proof):
        raise SystemExit("proof verification failed")
    print("proof verified")


if __name__ == "__main__":
    main()
