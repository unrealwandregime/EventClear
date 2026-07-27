from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from z3 import Int, Optimize, Or, sat

from .models import ProofArtifact, SolverRequest, SolverResult, TerminalWorld

SOLVER_VERSION = "eventclear-crypto-threshold-z3/1.0.0"
ZERO_HASH = "0x" + "00" * 32


def canonical_bytes(value: object) -> bytes:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", exclude_none=True)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _hash(value: object) -> str:
    return "0x" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def _rejections(request: SolverRequest) -> list[str]:
    model = request.payoutModel
    reasons: list[str] = []
    if request.relationshipDefinitionHash != model.definitionHash:
        reasons.append("RELATIONSHIP_HASH_MISMATCH")
    if request.definitionVersion != model.definitionVersion:
        reasons.append("RELATIONSHIP_VERSION_MISMATCH")
    if not model.payoutSemanticsComplete:
        reasons.append("INCOMPLETE_PAYOUT_SEMANTICS")
    if not model.compatibilityChecksPassed:
        reasons.extend(model.incompatibilityReasons or ["INCOMPATIBLE_MARKET_RULES"])
    seen: set[tuple[str, str]] = set()
    for leg in request.legs:
        key = (leg.conditionId, leg.tokenId)
        if key in seen:
            reasons.append(f"DUPLICATE_LEG:{leg.tokenId}")
        seen.add(key)
        token = model.allowedTokens.get(leg.tokenId)
        if token is None:
            reasons.append(f"TOKEN_NOT_IN_DEFINITION:{leg.tokenId}")
        elif token.get("conditionId") != leg.conditionId or token.get("outcome") != leg.outcome:
            reasons.append(f"LEG_SEMANTICS_MISMATCH:{leg.tokenId}")
    if not model.validWorlds:
        reasons.append("NO_VALID_TERMINAL_WORLDS")
    return sorted(set(reasons))


def solve(request: SolverRequest, *, include_all_worlds: bool = True, timestamp: str | None = None) -> SolverResult:
    reasons = _rejections(request)
    calculated_at = timestamp or datetime.now(UTC).isoformat().replace("+00:00", "Z")
    worlds: list[TerminalWorld] = []
    if not reasons:
        for candidate in sorted(request.payoutModel.validWorlds, key=lambda item: item.worldId):
            leg_payouts: list[str] = []
            total = 0
            for leg in request.legs:
                per_share = int(candidate.payoutsAtomicByToken.get(leg.tokenId, "0"))
                payout = int(leg.amountAtomic) * per_share // 1_000_000
                total += payout
                leg_payouts.append(str(payout))
            worlds.append(
                TerminalWorld(
                    worldId=candidate.worldId,
                    assignments=candidate.assignments,
                    totalPayoutAtomic=str(total),
                    payoutsAtomicByLeg=leg_payouts,
                )
            )
    if not worlds:
        base = SolverResult(
            approvedDefinitionFound=not any(
                reason in {"RELATIONSHIP_HASH_MISMATCH", "RELATIONSHIP_VERSION_MISMATCH"}
                for reason in reasons
            ),
            satisfiable=False,
            financingEligible=False,
            guaranteedFloorAtomic="0",
            maximumPayoutAtomic="0",
            validWorldCount=0,
            terminalWorlds=[],
            minimumWitnessWorlds=[],
            maximumWitnessWorlds=[],
            inputHash=_hash(request),
            definitionHash=request.relationshipDefinitionHash,
            artifactHash=ZERO_HASH,
            solverVersion=SOLVER_VERSION,
            generatedAt=calculated_at,
            rejectionCodes=reasons or ["UNSATISFIABLE_CONSTRAINTS"],
            rejectionExplanations=[
                reason.replace("_", " ").replace(":", ": ")
                for reason in (reasons or ["UNSATISFIABLE_CONSTRAINTS"])
            ],
        )
    else:
        # Z3 proves the extrema over the reviewed terminal-world constraint set.
        payout = Int("terminal_payout_atomic")
        domain = Or(*[payout == int(world.totalPayoutAtomic) for world in worlds])
        minimizer = Optimize()
        minimizer.add(domain)
        low_handle = minimizer.minimize(payout)
        maximizer = Optimize()
        maximizer.add(domain)
        high_handle = maximizer.maximize(payout)
        if minimizer.check() != sat or maximizer.check() != sat:
            worlds = []
            return solve(
                request.model_copy(update={"payoutModel": request.payoutModel.model_copy(update={"validWorlds": []})}),
                include_all_worlds=include_all_worlds,
                timestamp=calculated_at,
            )
        low = low_handle.lower().as_long()
        high = high_handle.upper().as_long()
        base = SolverResult(
            approvedDefinitionFound=True,
            satisfiable=True,
            financingEligible=True,
            guaranteedFloorAtomic=str(low),
            maximumPayoutAtomic=str(high),
            validWorldCount=len(worlds),
            terminalWorlds=worlds if include_all_worlds else [],
            minimumWitnessWorlds=[world for world in worlds if int(world.totalPayoutAtomic) == low],
            maximumWitnessWorlds=[world for world in worlds if int(world.totalPayoutAtomic) == high],
            inputHash=_hash(request),
            definitionHash=request.relationshipDefinitionHash,
            artifactHash=ZERO_HASH,
            solverVersion=SOLVER_VERSION,
            generatedAt=calculated_at,
            rejectionCodes=[],
            rejectionExplanations=[],
        )
    payload = {"request": request.model_dump(mode="json"), "result": base.model_dump(mode="json", exclude={"artifactHash"})}
    return base.model_copy(update={"artifactHash": _hash(payload)})


def verify_artifact(path: str | Path) -> bool:
    artifact = ProofArtifact.model_validate_json(Path(path).read_text(encoding="utf-8"))
    reproduced = solve(
        artifact.request,
        include_all_worlds=bool(artifact.result.terminalWorlds),
        timestamp=artifact.result.generatedAt,
    )
    return canonical_bytes(reproduced) == canonical_bytes(artifact.result)
