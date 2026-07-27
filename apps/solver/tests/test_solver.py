import unittest
import random
import json
import tempfile
from pathlib import Path

from eventclear_solver.engine import solve, verify_artifact
from eventclear_solver.models import ProofArtifact, SolverRequest

UNIT = 1_000_000
DEFINITION_HASH = "0x" + "ab" * 32


def threshold_request(low_amount: int, high_no_amount: int, *, compatible: bool = True) -> SolverRequest:
    worlds = [
        {"worldId": "below", "assignments": {"priceBand": 0}, "payoutsAtomicByToken": {"low-yes": "0", "high-no": str(UNIT)}},
        {"worldId": "middle", "assignments": {"priceBand": 1}, "payoutsAtomicByToken": {"low-yes": str(UNIT), "high-no": str(UNIT)}},
        {"worldId": "above", "assignments": {"priceBand": 2}, "payoutsAtomicByToken": {"low-yes": str(UNIT), "high-no": "0"}},
    ]
    return SolverRequest.model_validate({
        "relationshipDefinitionHash": DEFINITION_HASH,
        "definitionVersion": 1,
        "legs": [
            {"conditionId": "condition-low", "tokenId": "low-yes", "outcome": "YES", "amountAtomic": str(low_amount * UNIT)},
            {"conditionId": "condition-high", "tokenId": "high-no", "outcome": "NO", "amountAtomic": str(high_no_amount * UNIT)},
        ],
        "payoutModel": {
            "definitionHash": DEFINITION_HASH,
            "definitionVersion": 1,
            "allowedTokens": {
                "low-yes": {"conditionId": "condition-low", "outcome": "YES"},
                "high-no": {"conditionId": "condition-high", "outcome": "NO"},
            },
            "validWorlds": worlds,
            "compatibilityChecksPassed": compatible,
            "incompatibilityReasons": [] if compatible else ["OBSERVATION_TYPE_MISMATCH"],
        },
    })


class SolverTests(unittest.TestCase):
    def test_equal_quantities(self):
        result = solve(threshold_request(100, 100), timestamp="2026-01-01T00:00:00Z")
        self.assertEqual(result.guaranteedFloorAtomic, str(100 * UNIT))
        self.assertEqual(result.maximumPayoutAtomic, str(200 * UNIT))
        self.assertEqual(result.validWorldCount, 3)

    def test_unequal_quantities(self):
        result = solve(threshold_request(80, 100), timestamp="2026-01-01T00:00:00Z")
        self.assertEqual(result.guaranteedFloorAtomic, str(80 * UNIT))
        self.assertEqual(result.maximumPayoutAtomic, str(180 * UNIT))

    def test_reversed_quantities(self):
        result = solve(threshold_request(100, 80), timestamp="2026-01-01T00:00:00Z")
        self.assertEqual(result.guaranteedFloorAtomic, str(80 * UNIT))
        self.assertEqual(result.maximumPayoutAtomic, str(180 * UNIT))

    def test_incompatible_observation_types(self):
        result = solve(threshold_request(100, 100, compatible=False))
        self.assertFalse(result.isSatisfiable)
        self.assertIn("OBSERVATION_TYPE_MISMATCH", result.rejectionReasons)

    def test_incompatible_timestamp_and_price_source(self):
        for code in ("OBSERVATION_TIMESTAMP_MISMATCH", "PRICE_SOURCE_MISMATCH"):
            request = threshold_request(100, 100)
            request.payoutModel.compatibilityChecksPassed = False
            request.payoutModel.incompatibilityReasons = [code]
            result = solve(request)
            self.assertFalse(result.financingEligible)
            self.assertIn(code, result.rejectionCodes)

    def test_fractional_resolution_is_conservative(self):
        request = threshold_request(100, 100)
        request.payoutModel.validWorlds.append(
            request.payoutModel.validWorlds[0].model_copy(update={
                "worldId": "fifty-fifty",
                "payoutsAtomicByToken": {"low-yes": "500000", "high-no": "500000"},
            })
        )
        result = solve(request)
        self.assertEqual(result.guaranteedFloorAtomic, str(100 * UNIT))

    def test_duplicate_leg_rejected(self):
        request = threshold_request(100, 100)
        request.legs.append(request.legs[0])
        result = solve(request)
        self.assertFalse(result.isSatisfiable)
        self.assertTrue(any(reason.startswith("DUPLICATE_LEG") for reason in result.rejectionReasons))

    def test_unknown_token_rejected(self):
        request = threshold_request(100, 100)
        request.legs[0].tokenId = "unknown-token"
        result = solve(request)
        self.assertFalse(result.financingEligible)
        self.assertIn("TOKEN_NOT_IN_DEFINITION:unknown-token", result.rejectionCodes)

    def test_contradictory_definition_rejected(self):
        request = threshold_request(100, 100)
        request.payoutModel.validWorlds = []
        result = solve(request)
        self.assertFalse(result.satisfiable)
        self.assertIn("NO_VALID_TERMINAL_WORLDS", result.rejectionCodes)

    def test_three_threshold_ladder(self):
        request = SolverRequest.model_validate({
            "relationshipDefinitionHash": DEFINITION_HASH,
            "relationshipVersion": 2,
            "legs": [
                {"conditionId": "low", "tokenId": "low-yes", "outcome": "YES", "amountAtomic": str(100 * UNIT)},
                {"conditionId": "mid", "tokenId": "mid-no", "outcome": "NO", "amountAtomic": str(60 * UNIT)},
                {"conditionId": "high", "tokenId": "high-no", "outcome": "NO", "amountAtomic": str(80 * UNIT)},
            ],
            "payoutModel": {
                "definitionHash": DEFINITION_HASH,
                "definitionVersion": 2,
                "allowedTokens": {
                    "low-yes": {"conditionId": "low", "outcome": "YES"},
                    "mid-no": {"conditionId": "mid", "outcome": "NO"},
                    "high-no": {"conditionId": "high", "outcome": "NO"},
                },
                "validWorlds": [
                    {"worldId": "below", "assignments": {"band": 0}, "payoutsAtomicByToken": {"low-yes": "0", "mid-no": str(UNIT), "high-no": str(UNIT)}},
                    {"worldId": "low-mid", "assignments": {"band": 1}, "payoutsAtomicByToken": {"low-yes": str(UNIT), "mid-no": str(UNIT), "high-no": str(UNIT)}},
                    {"worldId": "mid-high", "assignments": {"band": 2}, "payoutsAtomicByToken": {"low-yes": str(UNIT), "mid-no": "0", "high-no": str(UNIT)}},
                    {"worldId": "above", "assignments": {"band": 3}, "payoutsAtomicByToken": {"low-yes": str(UNIT), "mid-no": "0", "high-no": "0"}},
                ],
            },
        })
        result = solve(request)
        self.assertEqual(result.guaranteedFloorAtomic, str(100 * UNIT))
        self.assertEqual(result.maximumPayoutAtomic, str(240 * UNIT))
        self.assertEqual(result.validWorldCount, 4)

    def test_artifact_reproduction_and_tamper_rejection(self):
        request = threshold_request(100, 100)
        artifact = ProofArtifact(
            request=request,
            result=solve(request, timestamp="2026-01-01T00:00:00Z"),
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            path.write_text(artifact.model_dump_json(), encoding="utf-8")
            self.assertTrue(verify_artifact(path))
            modified = json.loads(path.read_text(encoding="utf-8"))
            modified["result"]["guaranteedFloorAtomic"] = "1"
            path.write_text(json.dumps(modified), encoding="utf-8")
            self.assertFalse(verify_artifact(path))

    def test_property_z3_matches_brute_force_for_unequal_quantities(self):
        rng = random.Random(137)
        for _ in range(200):
            low = rng.randint(1, 1_000)
            high_no = rng.randint(1, 1_000)
            result = solve(threshold_request(low, high_no))
            brute = [high_no, low + high_no, low]
            self.assertEqual(int(result.guaranteedFloorAtomic) // UNIT, min(brute))
            self.assertEqual(int(result.maximumPayoutAtomic) // UNIT, max(brute))


if __name__ == "__main__":
    unittest.main()
