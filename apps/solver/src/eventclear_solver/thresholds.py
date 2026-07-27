from __future__ import annotations

from collections import Counter
from fractions import Fraction

from .models import PayoutModel, PayoutVector


UNIT = 1_000_000
COMPATIBILITY_FIELDS = {
    "underlyingAsset": "UNDERLYING_ASSET_MISMATCH",
    "quoteCurrency": "QUOTE_CURRENCY_MISMATCH",
    "observationType": "OBSERVATION_TYPE_MISMATCH",
    "observationTimestamp": "OBSERVATION_TIMESTAMP_MISMATCH",
    "priceSource": "PRICE_SOURCE_MISMATCH",
    "resolutionSource": "RESOLUTION_SOURCE_MISMATCH",
    "cancellationBehavior": "CANCELLATION_BEHAVIOR_MISMATCH",
    "fractionalResolutionBehavior": "FRACTIONAL_RESOLUTION_BEHAVIOR_MISMATCH",
    "ruleDocumentHash": "RULE_DOCUMENT_HASH_MISMATCH",
}


def _truth(comparator: str, value: Fraction, threshold: int) -> bool:
    boundary = Fraction(threshold)
    return {
        "GT": value > boundary,
        "GTE": value >= boundary,
        "LT": value < boundary,
        "LTE": value <= boundary,
    }[comparator]


def _canonical_payout(world: PayoutVector, tokens: set[str]) -> tuple[tuple[str, int], ...]:
    if set(world.payoutsAtomicByToken) != tokens:
        raise ValueError("WORLD_TOKEN_SET_MISMATCH")
    values = tuple(sorted((token, int(value)) for token, value in world.payoutsAtomicByToken.items()))
    if any(value < 0 or value > UNIT for _, value in values):
        raise ValueError("WORLD_PAYOUT_OUT_OF_RANGE")
    return values


def generate_threshold_worlds(
    model: PayoutModel,
    *,
    verify_reviewed: bool = True,
) -> tuple[list[PayoutVector], list[str]]:
    reasons: list[str] = []
    predicates = model.predicates
    first = predicates[0]
    for field, code in COMPATIBILITY_FIELDS.items():
        if any(getattr(predicate, field) != getattr(first, field) for predicate in predicates[1:]):
            reasons.append(code)
    if any(predicate.ruleDocumentHash != model.ruleDocumentHash for predicate in predicates):
        reasons.append("RULE_DOCUMENT_HASH_MISMATCH")

    by_condition: dict[str, object] = {}
    for predicate in predicates:
        previous = by_condition.get(predicate.conditionId)
        if previous is not None and previous != predicate:
            reasons.append("CONTRADICTORY_PREDICATES")
        elif previous is not None:
            reasons.append("DUPLICATE_PREDICATE")
        by_condition[predicate.conditionId] = predicate

    tokens = set(model.allowedTokens)
    for token_id, semantics in model.allowedTokens.items():
        predicate = by_condition.get(semantics.get("conditionId", ""))
        if predicate is None:
            reasons.append(f"TOKEN_CONDITION_NOT_REVIEWED:{token_id}")
        if semantics.get("outcome") not in {"YES", "NO"}:
            reasons.append(f"TOKEN_OUTCOME_INVALID:{token_id}")
    if reasons:
        return [], sorted(set(reasons))

    thresholds = sorted({int(predicate.thresholdAtomic) for predicate in predicates})
    representatives: list[Fraction] = [Fraction(thresholds[0] - 1)]
    for index, threshold in enumerate(thresholds):
        representatives.append(Fraction(threshold))
        if index + 1 < len(thresholds):
            representatives.append(Fraction(threshold + thresholds[index + 1], 2))
    representatives.append(Fraction(thresholds[-1] + 1))

    regions: list[tuple[tuple[bool, ...], Fraction]] = []
    ordered_predicates = sorted(
        predicates,
        key=lambda item: (
            int(item.thresholdAtomic),
            item.comparator,
            item.conditionId,
        ),
    )
    for representative in representatives:
        truth_vector = tuple(
            _truth(predicate.comparator, representative, int(predicate.thresholdAtomic))
            for predicate in ordered_predicates
        )
        if not regions or regions[-1][0] != truth_vector:
            regions.append((truth_vector, representative))

    generated: list[PayoutVector] = []
    predicate_index = {
        predicate.conditionId: index for index, predicate in enumerate(ordered_predicates)
    }
    for index, (truth_vector, representative) in enumerate(regions):
        payouts: dict[str, str] = {}
        for token_id, semantics in sorted(model.allowedTokens.items()):
            predicate_truth = truth_vector[predicate_index[semantics["conditionId"]]]
            token_wins = predicate_truth if semantics["outcome"] == "YES" else not predicate_truth
            payouts[token_id] = str(UNIT if token_wins else 0)
        generated.append(
            PayoutVector(
                worldId=f"region-{index:03d}",
                assignments={
                    "representativePrice": (
                        str(representative.numerator)
                        if representative.denominator == 1
                        else f"{representative.numerator}/{representative.denominator}"
                    )
                },
                payoutsAtomicByToken=payouts,
            )
        )

    try:
        for exceptional in model.exceptionalWorlds:
            _canonical_payout(exceptional, tokens)
            generated.append(exceptional)
        if not verify_reviewed:
            return generated, []
        generated_counter = Counter(_canonical_payout(world, tokens) for world in generated)
        reviewed_counter = Counter(_canonical_payout(world, tokens) for world in model.validWorlds)
    except (TypeError, ValueError):
        return [], ["REVIEWED_WORLD_INVALID"]
    if generated_counter - reviewed_counter:
        reasons.append("REVIEWED_WORLDS_MISSING")
    if reviewed_counter - generated_counter:
        reasons.append("REVIEWED_WORLDS_EXTRA")
    if reasons:
        reasons.append("REVIEWED_WORLD_SET_MISMATCH")
        return [], sorted(set(reasons))
    return generated, []
