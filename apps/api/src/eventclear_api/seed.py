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
        self.sessions: dict[str, dict] = {}
        self.next_nonce = 1

    def reset(self) -> None:
        self.__init__()

    def create_siwe_nonce(self, nonce: str, expires_at: float) -> None:
        self.siwe_nonces[nonce] = expires_at

    def consume_siwe_nonce(self, nonce: str, now: float) -> bool:
        expires_at = self.siwe_nonces.pop(nonce, 0)
        return expires_at >= now

    def create_session(self, token: str, address: str, expires_at: float) -> None:
        self.sessions[token] = {"address": address, "expiresAt": expires_at}

    def list_markets(self) -> list[dict]:
        return deepcopy(self.markets)

    def get_market(self, condition_id: str) -> dict | None:
        item = next((item for item in self.markets if item["conditionId"] == condition_id), None)
        return deepcopy(item) if item else None

    def list_relationships(self) -> list[dict]:
        return deepcopy(self.relationships)

    def get_relationship(self, relationship_id: str) -> dict | None:
        item = next((item for item in self.relationships if item["id"] == relationship_id), None)
        return deepcopy(item) if item else None

    def get_relationship_by_hash(self, definition_hash: str) -> dict | None:
        item = next(
            (item for item in self.relationships if item["canonicalDefinitionHash"] == definition_hash),
            None,
        )
        return deepcopy(item) if item else None

    def create_relationship(self, item: dict) -> dict:
        if any(existing["id"] == item["id"] for existing in self.relationships):
            raise ValueError("RELATIONSHIP_ALREADY_EXISTS")
        self.relationships.append(deepcopy(item))
        return deepcopy(item)

    def set_relationship_status(self, relationship_id: str, status: str) -> dict | None:
        item = next((item for item in self.relationships if item["id"] == relationship_id), None)
        if item is None:
            return None
        item["status"] = status
        return deepcopy(item)

    def allocate_quote_nonce(self) -> int:
        nonce = self.next_nonce
        self.next_nonce += 1
        return nonce

    def save_quote(self, quote_id: str, value: dict) -> None:
        self.quotes[quote_id] = deepcopy(value)

    def get_quote(self, quote_id: str) -> dict | None:
        value = self.quotes.get(quote_id)
        return deepcopy(value) if value else None

    def list_bundles(self) -> list[dict]:
        return deepcopy(self.bundles)

    def get_bundle(self, bundle_id: str) -> dict | None:
        item = next((item for item in self.bundles if item["id"] == bundle_id), None)
        return deepcopy(item) if item else None

    def append_audit_log(self, entry: dict) -> None:
        self.audit_logs.append(deepcopy(entry))
