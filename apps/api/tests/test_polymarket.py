from __future__ import annotations

import time
import unittest

import httpx

from eventclear_api.polymarket import PolymarketReadGateway


class PolymarketGatewayTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def gateway(handler, freshness_seconds: int = 30) -> PolymarketReadGateway:
        return PolymarketReadGateway(
            "https://gamma.test",
            "https://data.test",
            "https://clob.test",
            (),
            freshness_seconds=freshness_seconds,
            transport=httpx.MockTransport(handler),
        )

    async def test_order_book_normalizes_exact_decimals_and_freshness(self):
        token_id = "123456789"

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/book")
            self.assertEqual(request.url.params["token_id"], token_id)
            return httpx.Response(
                200,
                json={
                    "market": "0x" + "11" * 32,
                    "asset_id": token_id,
                    "timestamp": str(int(time.time() * 1000)),
                    "hash": "0xbook",
                    "bids": [{"price": "0.4500", "size": "100.25"}],
                    "asks": [{"price": "0.46", "size": "99"}],
                    "min_order_size": "5",
                    "tick_size": "0.01",
                    "neg_risk": False,
                    "last_trade_price": "0.455",
                },
            )

        book = await self.gateway(handler).order_book(token_id)
        self.assertFalse(book["stale"])
        self.assertEqual(book["bids"], [{"price": "0.4500", "size": "100.25"}])
        self.assertEqual(book["asks"], [{"price": "0.46", "size": "99"}])
        self.assertEqual(book["source"], "clob-live")

    async def test_order_book_keeps_source_lag_as_telemetry(self):
        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "market": "0x" + "22" * 32,
                    "asset_id": "42",
                    "timestamp": str(int((time.time() - 120) * 1000)),
                    "hash": "0xold",
                    "bids": [],
                    "asks": [],
                    "min_order_size": "1",
                    "tick_size": "0.01",
                    "neg_risk": False,
                    "last_trade_price": "0.5",
                },
            )

        book = await self.gateway(handler).order_book("42")
        self.assertFalse(book["stale"])
        self.assertGreater(book["sourceLagSeconds"], 100)

    async def test_price_history_rejects_non_monotonic_data(self):
        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"history": [{"t": 2, "p": "0.5"}, {"t": 1, "p": "0.6"}]})

        with self.assertRaisesRegex(RuntimeError, "POLYMARKET_HISTORY_ORDER_INVALID"):
            await self.gateway(handler).price_history("42")

    async def test_price_history_validates_interval_before_network(self):
        def handler(_: httpx.Request) -> httpx.Response:
            raise AssertionError("network should not be called")

        with self.assertRaisesRegex(RuntimeError, "POLYMARKET_HISTORY_INTERVAL_INVALID"):
            await self.gateway(handler).price_history("42", interval="quarter")


if __name__ == "__main__":
    unittest.main()
