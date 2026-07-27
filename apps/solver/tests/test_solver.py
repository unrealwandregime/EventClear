import unittest
import random
import json
import tempfile
from pathlib import Path

from eventclear_solver.engine import solve, verify_artifact
from eventclear_solver.models import ProofArtifact, SolverRequest
from eventclear_solver.thresholds import generate_threshold_worlds

UNIT = 1_000_000
DEFINITION_HASH = "0x" + "ab" * 32
RULE_HASH = "0x" + "cd" * 32


def predicate(condition_id: str, threshold: int, comparator: str = "GT") -> dict:
    return {
        "conditionId": condition_id,
        "underlyingAsset": "BTC",
        "quoteCurrency": "USD",
        "comparator": comparator,
        "thresholdAtomic": str(threshold),
        "observationType": "CLOSING_PRICE",
        "observationTimestamp": "2026-12-31T23:59:59Z",
        "priceSource": "official-index",
        "resolutionSource": "official-index",
        "cancellationBehavior": "HALF_HALF",
        "fractionalResolutionBehavior": "USE_REPORTED_PAYOUT",
        "ruleDocumentHash": RULE_HASH,
    }


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
            "ruleDocumentHash": RULE_HASH,
            "predicates": [
                predicate("condition-low", 100),
                predicate("condition-high", 150),
            ],
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
        request.payoutModel.exceptionalWorlds.append(request.payoutModel.validWorlds[-1])
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
                "ruleDocumentHash": RULE_HASH,
                "predicates": [
                    predicate("low", 100),
                    predicate("mid", 150),
                    predicate("high", 200),
                ],
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

    def test_strict_and_inclusive_boundaries_generate_distinct_exact_region(self):
        request = threshold_request(100, 100)
        request.payoutModel.predicates[1] = request.payoutModel.predicates[1].model_copy(
            update={
                "thresholdAtomic": "100",
                "comparator": "GTE",
            }
        )
        worlds, reasons = generate_threshold_worlds(
            request.payoutModel,
            verify_reviewed=False,
        )
        self.assertEqual(reasons, [])
        request.payoutModel.validWorlds = worlds
        result = solve(request)
        self.assertTrue(result.financingEligible)
        self.assertEqual(result.validWorldCount, 3)
        self.assertIn(
            {"low-yes": "0", "high-no": "0"},
            [world.payoutsAtomicByToken for world in request.payoutModel.validWorlds],
        )

    def test_lt_and_lte_boundaries_use_exact_integer_comparisons(self):
        request = threshold_request(100, 100)
        request.payoutModel.predicates[0] = request.payoutModel.predicates[0].model_copy(
            update={"comparator": "LT"}
        )
        request.payoutModel.predicates[1] = request.payoutModel.predicates[1].model_copy(
            update={"thresholdAtomic": "100", "comparator": "LTE"}
        )
        worlds, reasons = generate_threshold_worlds(
            request.payoutModel,
            verify_reviewed=False,
        )
        self.assertEqual(reasons, [])
        request.payoutModel.validWorlds = worlds
        self.assertEqual(solve(request).validWorldCount, 3)

    def test_duplicate_thresholds_are_collapsed_without_missing_states(self):
        request = threshold_request(100, 100)
        request.payoutModel.predicates[1] = request.payoutModel.predicates[1].model_copy(
            update={"thresholdAtomic": "100"}
        )
        worlds, reasons = generate_threshold_worlds(
            request.payoutModel,
            verify_reviewed=False,
        )
        self.assertEqual(reasons, [])
        self.assertEqual(len(worlds), 2)
        request.payoutModel.validWorlds = worlds
        self.assertTrue(solve(request).financingEligible)

    def test_contradictory_predicates_for_one_condition_are_rejected(self):
        request = threshold_request(100, 100)
        request.payoutModel.predicates[1] = request.payoutModel.predicates[1].model_copy(
            update={"conditionId": "condition-low"}
        )
        result = solve(request)
        self.assertFalse(result.financingEligible)
        self.assertIn("CONTRADICTORY_PREDICATES", result.rejectionCodes)

    def test_missing_and_extra_reviewed_regions_are_rejected(self):
        missing = threshold_request(100, 100)
        missing.payoutModel.validWorlds.pop()
        missing_result = solve(missing)
        self.assertIn("REVIEWED_WORLDS_MISSING", missing_result.rejectionCodes)
        self.assertIn("REVIEWED_WORLD_SET_MISMATCH", missing_result.rejectionCodes)

        extra = threshold_request(100, 100)
        extra.payoutModel.validWorlds.append(extra.payoutModel.validWorlds[0])
        extra_result = solve(extra)
        self.assertIn("REVIEWED_WORLDS_EXTRA", extra_result.rejectionCodes)
        self.assertIn("REVIEWED_WORLD_SET_MISMATCH", extra_result.rejectionCodes)

    def test_reordered_predicates_produce_same_payout_regions(self):
        original = threshold_request(100, 80)
        reordered = threshold_request(100, 80)
        reordered.payoutModel.predicates.reverse()
        first = solve(original, timestamp="2026-01-01T00:00:00Z")
        second = solve(reordered, timestamp="2026-01-01T00:00:00Z")
        self.assertEqual(first.guaranteedFloorAtomic, second.guaranteedFloorAtomic)
        self.assertEqual(first.maximumPayoutAtomic, second.maximumPayoutAtomic)
        self.assertEqual(
            [world.payoutsAtomicByLeg for world in first.terminalWorlds],
            [world.payoutsAtomicByLeg for world in second.terminalWorlds],
        )

    def test_modified_rule_hash_is_rejected(self):
        request = threshold_request(100, 100)
        request.payoutModel.predicates[0] = request.payoutModel.predicates[0].model_copy(
            update={"ruleDocumentHash": "0x" + "ef" * 32}
        )
        result = solve(request)
        self.assertFalse(result.financingEligible)
        self.assertIn("RULE_DOCUMENT_HASH_MISMATCH", result.rejectionCodes)


if __name__ == "__main__":
    unittest.main()
