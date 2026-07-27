from __future__ import annotations

from copy import deepcopy

UNIT = 1_000_000
HASH = "0x" + "ab" * 32

MARKETS = [
    {"conditionId": "btc-100", "question": "Will BTC official index close above $100,000?", "asset": "BTC", "threshold": 100000, "observation": "CLOSE_AT", "endDate": "2026-12-31T23:59:59Z", "tokenIds": ["btc-100-y", "btc-100-n"], "active": True},
    {"conditionId": "btc-150", "question": "Will BTC official index close above $150,000?", "asset": "BTC", "threshold": 150000, "observation": "CLOSE_AT", "endDate": "2026-12-31T23:59:59Z", "tokenIds": ["btc-150-y", "btc-150-n"], "active": True},
    {"conditionId": "eth-any", "question": "Will ETH trade above $8,000 at any time?", "asset": "ETH", "threshold": 8000, "observation": "REACHES_ANY_TIME", "endDate": "2026-09-30T23:59:59Z", "tokenIds": ["eth-any-y", "eth-any-n"], "active": True},
]

RELATIONSHIPS = [{
    "id": "btc-close-ladder",
    "version": 3,
    "relationshipType": "CRYPTO_THRESHOLD",
    "status": "APPROVED",
    "marketConditionIds": ["btc-100", "btc-150"],
    "tokenIds": ["btc-100-y", "btc-150-n"],
    "resolutionRulesHash": "0x" + "cd" * 32,
    "canonicalDefinitionHash": HASH,
    "approvedBy": "local-reviewer",
    "approvedAt": "2026-07-27T00:00:00Z",
    "validFrom": "2026-07-27T00:00:00Z",
}]

POSITIONS = [
    {"conditionId": "btc-100", "tokenId": "btc-100-y", "outcome": "YES", "amountAtomic": str(100 * UNIT), "currentValueAtomic": str(64 * UNIT)},
    {"conditionId": "btc-150", "tokenId": "btc-150-n", "outcome": "NO", "amountAtomic": str(100 * UNIT), "currentValueAtomic": str(62_400_000)},
]


class MemoryStore:
    def __init__(self) -> None:
        self.markets = deepcopy(MARKETS)
        self.relationships = deepcopy(RELATIONSHIPS)
        self.quotes: dict[str, dict] = {}
        self.bundles = [{"id": "EC-00418", "status": "ACTIVE", "principalAmountAtomic": str(100 * UNIT), "advanceAmountAtomic": "93500000"}]
        self.audit_logs: list[dict] = []
        self.siwe_nonces: dict[str, float] = {}
        self.sessions: dict[str, str] = {}
        self.next_nonce = 1

    def reset(self) -> None:
        self.__init__()
