"""Explicit test-asset gateway. Never used by any production mode."""

import hashlib
import json
import time
from pathlib import Path
from .polymarket import PolymarketReadGateway


def load_fixture(settings):
    if settings.normalized_mode != "staging" or settings.chain_id in {
        1,
        137,
        31337,
        1337,
    }:
        raise RuntimeError("PERSISTENT_STAGING_CHAIN_REQUIRED")
    fixture = json.loads(Path(settings.staging_fixture_path).read_text())
    source = json.loads(Path("config/staging/relationship.json").read_text())

    def canonical(x):
        return json.dumps(
            x, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()

    if (
        fixture.get("testAssetsOnly") is not True
        or fixture["hashPayload"]["source"] != source
    ):
        raise RuntimeError("STAGING_FIXTURE_SOURCE_MISMATCH")
    relationship = fixture["relationship"]
    if (
        "0x" + hashlib.sha256(canonical(fixture["hashPayload"])).hexdigest()
        != relationship["canonicalDefinitionHash"]
    ):
        raise RuntimeError("STAGING_FIXTURE_HASH_MISMATCH")
    expected = fixture["hashPayload"]["definition"]
    actual = {
        k: v
        for k, v in relationship["solverDefinition"].items()
        if k != "definitionHash"
    }
    if (
        actual != expected
        or relationship["earliestResolutionTimestamp"]
        != fixture["hashPayload"]["earliest"]
        or relationship["latestResolutionTimestamp"] != fixture["hashPayload"]["latest"]
    ):
        raise RuntimeError("STAGING_FIXTURE_CONTENT_MISMATCH")
    return fixture


class StagingGateway(PolymarketReadGateway):
    def __init__(self, settings, fixture):
        super().__init__(
            "https://unused.invalid",
            "https://unused.invalid",
            "https://unused.invalid",
            settings.polygon_rpc_urls,
        )
        self.settings = settings
        self.fixture = fixture

    async def markets(self, limit=100):
        rows = []
        for i, market in enumerate(self.fixture["relationship"]["reviewedMarkets"]):
            item = dict(market)
            denominator = await self.contract_call(
                self.settings.conditional_tokens_address,
                "payoutDenominator(bytes32)",
                ["bytes32"],
                [bytes.fromhex(item["conditionId"][2:])],
            )
            item.update(
                question=f"STAGING TEST ONLY: threshold {i + 1}",
                observedAt=time.time(),
                active=denominator == 0,
                closed=denominator != 0,
                resolved=denominator != 0,
                tokenIds=list(market["tokenIds"].values()),
            )
            rows.append(item)
        return rows[:limit]

    async def market(self, condition_id):
        return next(
            (
                m
                for m in await self.markets()
                if m["conditionId"].lower() == condition_id.lower()
            ),
            None,
        )

    async def positions(self, address):
        rows = []
        for market in self.fixture["relationship"]["reviewedMarkets"]:
            for outcome, token in market["tokenIds"].items():
                amount = await self.contract_call(
                    self.settings.conditional_tokens_address,
                    "balanceOf(address,uint256)",
                    ["address", "uint256"],
                    [address, int(token)],
                )
                if amount:
                    rows.append(
                        {
                            "conditionId": market["conditionId"],
                            "tokenId": str(token),
                            "outcome": outcome,
                            "amountAtomic": str(amount),
                        }
                    )
        return rows

    async def order_book(self, token_id):
        if token_id not in {"1", "2", "3", "4"}:
            raise RuntimeError("STAGING_TOKEN_NOT_REVIEWED")
        # These mock assets have no order book. The test oracle is explicit,
        # while ownership/resolution/risk still use real remote contract reads.
        return {
            "tokenId": token_id,
            "negativeRisk": False,
            "stale": False,
            "observedAt": time.time(),
            "source": "staging-test-oracle",
        }


def initialize_fixture(store, fixture):
    relationship = fixture["relationship"]
    with store._connection() as connection:
        current = connection.execute(
            "SELECT payload FROM api_read_models WHERE kind='relationship' AND key=%s",
            (relationship["id"],),
        ).fetchone()
        if current and current[0] != relationship:
            raise RuntimeError("STAGING_RELATIONSHIP_REPLACEMENT_PROHIBITED")
        connection.execute(
            "INSERT INTO api_read_models(kind,key,payload) VALUES ('relationship',%s,%s::jsonb) ON CONFLICT DO NOTHING",
            (relationship["id"], json.dumps(relationship)),
        )
