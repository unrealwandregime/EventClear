from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any

import httpx


class PolymarketReadGateway:
    """Validated public-read gateway. It never holds builder or signing secrets."""

    def __init__(
        self,
        gamma_url: str,
        data_url: str,
        clob_url: str,
        rpc_urls: tuple[str, ...],
        timeout_seconds: float = 10.0,
        freshness_seconds: int = 30,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.gamma_url = gamma_url.rstrip("/")
        self.data_url = data_url.rstrip("/")
        self.clob_url = clob_url.rstrip("/")
        self.rpc_urls = rpc_urls
        self.timeout_seconds = timeout_seconds
        self.freshness_seconds = freshness_seconds
        self.transport = transport

    async def _get(self, url: str, params: dict[str, str]) -> Any:
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds, transport=self.transport) as client:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(0.25 * (2**attempt))
        raise RuntimeError("POLYMARKET_READ_UNAVAILABLE") from last_error

    @staticmethod
    def _decimal(raw: Any, code: str, *, maximum: Decimal | None = None) -> str:
        try:
            value = Decimal(str(raw))
        except (InvalidOperation, ValueError) as exc:
            raise RuntimeError(code) from exc
        if not value.is_finite() or value < 0 or (maximum is not None and value > maximum):
            raise RuntimeError(code)
        return format(value, "f")

    @staticmethod
    def _source_timestamp(raw: Any) -> float:
        try:
            numeric = float(raw)
            return numeric / 1000 if numeric > 10_000_000_000 else numeric
        except (TypeError, ValueError):
            try:
                return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
            except ValueError as exc:
                raise RuntimeError("POLYMARKET_BOOK_TIMESTAMP_INVALID") from exc

    @staticmethod
    def _token_ids(raw: Any) -> list[str]:
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                return []
        return [str(item) for item in raw] if isinstance(raw, list) else []

    async def markets(self, limit: int = 100) -> list[dict]:
        payload = await self._get(
            f"{self.gamma_url}/markets",
            {"active": "true", "closed": "false", "limit": str(min(max(limit, 1), 500))},
        )
        if not isinstance(payload, list):
            raise RuntimeError("POLYMARKET_GAMMA_SCHEMA_INVALID")
        result: list[dict] = []
        for item in payload:
            if not isinstance(item, dict) or not item.get("conditionId"):
                continue
            result.append(
                {
                    "conditionId": item["conditionId"],
                    "questionId": item.get("questionID") or item.get("questionId"),
                    "marketId": str(item.get("id", "")),
                    "question": item.get("question", ""),
                    "description": item.get("description", ""),
                    "resolutionSource": item.get("resolutionSource"),
                    "endDate": item.get("endDateIso") or item.get("endDate"),
                    "active": bool(item.get("active")),
                    "closed": bool(item.get("closed")),
                    "negativeRisk": bool(item.get("negRisk")),
                    "tokenIds": self._token_ids(item.get("clobTokenIds")),
                    "minimumOrderSize": item.get("orderMinSize"),
                    "minimumTickSize": item.get("orderPriceMinTickSize"),
                    "source": "gamma-live",
                }
            )
        return result

    async def market(self, condition_id: str) -> dict | None:
        return next(
            (item for item in await self.markets(limit=500) if item["conditionId"].lower() == condition_id.lower()),
            None,
        )

    async def positions(self, address: str) -> list[dict]:
        payload = await self._get(
            f"{self.data_url}/positions",
            {"user": address, "sizeThreshold": "0"},
        )
        if not isinstance(payload, list):
            raise RuntimeError("POLYMARKET_DATA_SCHEMA_INVALID")
        result: list[dict] = []
        for item in payload:
            if not isinstance(item, dict) or not item.get("asset"):
                continue
            try:
                amount = int((Decimal(str(item.get("size", "0"))) * 1_000_000).to_integral_value(rounding=ROUND_DOWN))
                current_value = int(
                    (Decimal(str(item.get("currentValue", "0"))) * 1_000_000).to_integral_value(rounding=ROUND_DOWN)
                )
            except InvalidOperation as exc:
                raise RuntimeError("POLYMARKET_POSITION_DECIMAL_INVALID") from exc
            result.append({
                "conditionId": item.get("conditionId"),
                "tokenId": str(item.get("asset", "")),
                "outcome": item.get("outcome"),
                "amountAtomic": str(amount),
                "currentValueAtomic": str(current_value),
                "title": item.get("title"),
                "negativeRisk": bool(item.get("negativeRisk")),
                "source": "data-api-live",
            })
        return result

    async def order_book(self, token_id: str) -> dict:
        if not token_id.isdigit():
            raise RuntimeError("POLYMARKET_TOKEN_ID_INVALID")
        payload = await self._get(f"{self.clob_url}/book", {"token_id": token_id})
        if not isinstance(payload, dict) or str(payload.get("asset_id")) != token_id:
            raise RuntimeError("POLYMARKET_BOOK_SCHEMA_INVALID")

        def levels(name: str) -> list[dict[str, str]]:
            raw_levels = payload.get(name)
            if not isinstance(raw_levels, list):
                raise RuntimeError("POLYMARKET_BOOK_SCHEMA_INVALID")
            result: list[dict[str, str]] = []
            for level in raw_levels:
                if not isinstance(level, dict):
                    raise RuntimeError("POLYMARKET_BOOK_SCHEMA_INVALID")
                result.append(
                    {
                        "price": self._decimal(
                            level.get("price"),
                            "POLYMARKET_BOOK_PRICE_INVALID",
                            maximum=Decimal(1),
                        ),
                        "size": self._decimal(level.get("size"), "POLYMARKET_BOOK_SIZE_INVALID"),
                    }
                )
            return result

        source_timestamp = self._source_timestamp(payload.get("timestamp"))
        observed_at = time.time()
        return {
            "conditionId": str(payload.get("market", "")),
            "tokenId": token_id,
            "sourceTimestamp": source_timestamp,
            "sourceLagSeconds": max(0, observed_at - source_timestamp),
            "observedAt": observed_at,
            "stale": False,
            "hash": str(payload.get("hash", "")),
            "bids": levels("bids"),
            "asks": levels("asks"),
            "minimumOrderSize": self._decimal(
                payload.get("min_order_size"),
                "POLYMARKET_BOOK_MINIMUM_INVALID",
            ),
            "tickSize": self._decimal(
                payload.get("tick_size"),
                "POLYMARKET_BOOK_TICK_INVALID",
                maximum=Decimal(1),
            ),
            "negativeRisk": bool(payload.get("neg_risk")),
            "lastTradePrice": self._decimal(
                payload.get("last_trade_price", "0"),
                "POLYMARKET_BOOK_LAST_PRICE_INVALID",
                maximum=Decimal(1),
            ),
            "source": "clob-live",
        }

    async def price_history(
        self,
        token_id: str,
        interval: str = "1d",
        fidelity: int = 5,
    ) -> dict:
        if not token_id.isdigit():
            raise RuntimeError("POLYMARKET_TOKEN_ID_INVALID")
        if interval not in {"1h", "6h", "1d", "1w", "1m", "max", "all"}:
            raise RuntimeError("POLYMARKET_HISTORY_INTERVAL_INVALID")
        if not 1 <= fidelity <= 1_440:
            raise RuntimeError("POLYMARKET_HISTORY_FIDELITY_INVALID")
        payload = await self._get(
            f"{self.clob_url}/prices-history",
            {"market": token_id, "interval": interval, "fidelity": str(fidelity)},
        )
        raw_history = payload.get("history") if isinstance(payload, dict) else None
        if not isinstance(raw_history, list):
            raise RuntimeError("POLYMARKET_HISTORY_SCHEMA_INVALID")
        history: list[dict] = []
        last_timestamp = -1
        for point in raw_history:
            if not isinstance(point, dict):
                raise RuntimeError("POLYMARKET_HISTORY_SCHEMA_INVALID")
            try:
                timestamp = int(point["t"])
            except (KeyError, TypeError, ValueError) as exc:
                raise RuntimeError("POLYMARKET_HISTORY_SCHEMA_INVALID") from exc
            if timestamp <= last_timestamp:
                raise RuntimeError("POLYMARKET_HISTORY_ORDER_INVALID")
            last_timestamp = timestamp
            history.append(
                {
                    "timestamp": timestamp,
                    "price": self._decimal(
                        point.get("p"),
                        "POLYMARKET_HISTORY_PRICE_INVALID",
                        maximum=Decimal(1),
                    ),
                }
            )
        return {
            "tokenId": token_id,
            "interval": interval,
            "fidelityMinutes": fidelity,
            "observedAt": time.time(),
            "history": history,
            "source": "clob-live",
        }

    async def wallet_type(self, address: str) -> dict:
        if not self.rpc_urls:
            raise RuntimeError("RPC_FAILOVER_CONFIGURED")
        last_error: Exception | None = None
        for rpc_url in self.rpc_urls:
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds, transport=self.transport) as client:
                    response = await client.post(
                        rpc_url,
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "eth_getCode",
                            "params": [address, "latest"],
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                    code = payload.get("result")
                    if not isinstance(code, str):
                        raise RuntimeError("RPC_SCHEMA_INVALID")
                    wallet_type = "EOA" if code == "0x" else "CONTRACT_UNKNOWN"
                    return {
                        "signerAddress": address,
                        "positionWallet": address,
                        "walletType": wallet_type,
                        "capabilities": {
                            "readPositions": True,
                            "approveErc1155": wallet_type == "EOA",
                            "openBundle": wallet_type == "EOA",
                        },
                        "executionSupported": wallet_type == "EOA",
                        "reason": None if wallet_type == "EOA" else "UNVERIFIED_CONTRACT_WALLET_PATH",
                    }
            except (httpx.HTTPError, RuntimeError, ValueError) as exc:
                last_error = exc
        raise RuntimeError("ALL_POLYGON_RPCS_UNAVAILABLE") from last_error
