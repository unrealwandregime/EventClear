"""Compile the reviewed source fixture and verify its exact solver truth table."""

import hashlib
import json
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from eventclear_solver.engine import solve
from eventclear_solver.models import SolverRequest
from eventclear_api.seed import BTC_SOLVER_DEFINITION, RELATIONSHIPS


def canonical(x):
    return json.dumps(
        x, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def generate(now: int) -> dict:
    source = json.loads(Path("config/staging/relationship.json").read_text())
    if not source["testAssetsOnly"] or source["schema"] != "CRYPTO_THRESHOLD_V1":
        raise RuntimeError("TEST_FIXTURE_REQUIRED")
    # Short runnable test window, fixed per deployment and never regenerated on restart.
    earliest, latest = now + 3600, now + 86400
    rules = "0x" + hashlib.sha256(canonical(source["ruleDocument"])).hexdigest()
    definition = deepcopy(BTC_SOLVER_DEFINITION)
    definition["definitionVersion"] = 1
    definition["ruleDocumentHash"] = rules
    for i, predicate in enumerate(definition["predicates"]):
        predicate.update(
            conditionId=source["conditions"][i],
            underlyingAsset=source["asset"],
            thresholdAtomic=str(source["thresholds"][i]),
            observationTimestamp=datetime.fromtimestamp(
                earliest, timezone.utc
            ).isoformat(),
            priceSource="staging-test-oracle",
            resolutionSource="staging-test-oracle",
            ruleDocumentHash=rules,
        )
    for world, payouts in zip(
        definition["validWorlds"], source["payouts"], strict=True
    ):
        world["payoutsAtomicByToken"] = {"1": payouts[0], "4": payouts[1]}
    payload = {
        "source": source,
        "definition": {k: v for k, v in definition.items() if k != "definitionHash"},
        "earliest": earliest,
        "latest": latest,
    }
    definition_hash = "0x" + hashlib.sha256(canonical(payload)).hexdigest()
    definition["definitionHash"] = definition_hash
    relationship = deepcopy(RELATIONSHIPS[0])
    relationship.update(
        id="staging-threshold-v1",
        version=1,
        relationshipType=source["schema"],
        canonicalDefinitionHash=definition_hash,
        resolutionRulesHash=rules,
        solverDefinition=definition,
        earliestResolutionTimestamp=earliest,
        latestResolutionTimestamp=latest,
        approvedBy="checked-in-staging-template",
        status="APPROVED",
    )
    for market in relationship["reviewedMarkets"]:
        market.update(resolutionSource="staging-test-oracle", ruleDocumentHash=rules)
    request = {
        "relationshipDefinitionHash": definition_hash,
        "definitionVersion": 1,
        "legs": [
            {
                "conditionId": source["conditions"][0],
                "tokenId": "1",
                "outcome": "YES",
                "amountAtomic": "100000000",
            },
            {
                "conditionId": source["conditions"][1],
                "tokenId": "4",
                "outcome": "NO",
                "amountAtomic": "100000000",
            },
        ],
        "payoutModel": definition,
    }
    result = solve(SolverRequest.model_validate(request))
    if (
        not result.financingEligible
        or result.guaranteedFloorAtomic != "100000000"
        or result.validWorldCount != 3
    ):
        raise RuntimeError("STAGING_FIXTURE_SOLVER_MISMATCH")
    return {
        "testAssetsOnly": True,
        "sourceHash": "0x" + hashlib.sha256(canonical(source)).hexdigest(),
        "hashPayload": payload,
        "relationship": relationship,
        "solverRequest": request,
    }


if __name__ == "__main__":
    import time

    target = Path(sys.argv[1] if len(sys.argv) > 1 else "config/staging/deployed.json")
    target.write_text(json.dumps(generate(int(time.time())), indent=2) + "\n")
    print("Verified test fixture written; no secrets included.")
