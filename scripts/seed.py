"""Idempotent local seed summary; API embeds the same deterministic fixtures."""

import json

fixtures = {
    "cryptoThresholds": ["BTC equal bundle", "ETH unequal bundle", "incompatible any-time vs close"],
    "reviewQueues": ["Election implication awaiting review", "Approved sports progression"],
    "bundles": ["resolved success", "active bundle", "shortfall simulation"],
    "pool": ["pilot LP deposits", "protocol fee history"],
}
print(json.dumps({"seeded": True, "fixtures": fixtures}, indent=2))
