# Deterministic threshold-world generation

`CRYPTO_THRESHOLD_V1` solver definitions contain normalized reviewed
predicates, not only a hand-entered payout table. Each predicate commits to:

- asset and quote currency
- exact integer threshold and `GT`, `GTE`, `LT` or `LTE`
- observation type and timestamp
- price and resolution sources
- cancellation and fractional-resolution behavior
- rule-document hash

The solver sorts unique thresholds, evaluates exact rational representatives
below, at, between and above every boundary, and collapses only adjacent regions
with identical predicate truth values. It then derives YES/NO token payouts and
adds explicitly reviewed cancellation or fractional exceptional states.

No floating-point arithmetic is used.

The generated payout-vector multiset must exactly equal the independently
reviewed truth-table multiset. Missing regions, extra regions, invalid token
sets, incompatible predicate semantics, contradictory predicates and modified
rule hashes all make the relationship financing-ineligible.

The canonical proof artifact contains both the reviewed predicates and reviewed
truth table, while its result contains the generated terminal worlds and
minimum/maximum witnesses.
