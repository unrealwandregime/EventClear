from __future__ import annotations

import asyncio
import time
import uuid
import secrets
import hmac
from copy import deepcopy
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from redis.asyncio import from_url as redis_from_url
from redis.exceptions import RedisError
from eth_account import Account
from eth_account.messages import encode_defunct

from eventclear_solver.engine import solve
from eventclear_solver.models import ProofArtifact, SolverRequest

from .calldata import deposit, redeem_claim, withdraw
from .polymarket import PolymarketReadGateway
from .quote import issue_quote
from .repository import create_store
from .seed import POSITIONS
from .settings import Settings

settings = Settings()
settings.validate()
store = create_store(settings)
redis_client = redis_from_url(settings.redis_url, decode_responses=True) if settings.redis_url else None
polymarket = PolymarketReadGateway(
    settings.gamma_api_url,
    settings.data_api_url,
    settings.clob_api_url,
    settings.polygon_rpc_urls,
    freshness_seconds=settings.market_freshness_seconds,
)
REQUESTS = Counter("eventclear_api_requests_total", "API requests", ["method", "path", "status"])
LATENCY = Histogram("eventclear_api_latency_seconds", "API request latency", ["path"])
rate_windows: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate()
    if settings.normalized_mode in {"production-readonly", "production-controlled"}:
        if redis_client is None or not await redis_client.ping():
            raise RuntimeError("REDIS_RATE_LIMITER_UNAVAILABLE")
    yield
    if redis_client is not None:
        await redis_client.aclose()


app = FastAPI(title="EventClear API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def controls(request: Request, call_next):
    started = time.monotonic()
    correlation_id = request.headers.get("x-correlation-id", str(uuid.uuid4()))
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    if redis_client is not None:
        try:
            rate_key = f"eventclear:rate:{key}:{int(time.time() // 60)}"
            count = await redis_client.incr(rate_key)
            if count == 1:
                await redis_client.expire(rate_key, 61)
            if count > 120:
                return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "correlationId": correlation_id}})
        except RedisError:
            if settings.normalized_mode in {"production-readonly", "production-controlled"}:
                return JSONResponse(status_code=503, content={"error": {"code": "RATE_LIMITER_UNAVAILABLE", "correlationId": correlation_id}})
    else:
        window = rate_windows[key]
        while window and window[0] < now - 60:
            window.popleft()
        if len(window) >= 120:
            return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "correlationId": correlation_id}})
        window.append(now)
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["content-security-policy"] = "default-src 'self'"
    REQUESTS.labels(request.method, request.url.path, response.status_code).inc()
    LATENCY.labels(request.url.path).observe(time.monotonic() - started)
    return response


def admin(x_admin_token: str | None = Header(default=None)) -> str:
    if x_admin_token is None or not hmac.compare_digest(x_admin_token, settings.admin_api_token):
        raise HTTPException(status_code=403, detail={"code": "ADMIN_REQUIRED"})
    return "admin"


def authenticated_session(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, detail={"code": "SESSION_REQUIRED"})
    session = store.get_session(authorization.removeprefix("Bearer "), time.time())
    if session is None:
        raise HTTPException(401, detail={"code": "INVALID_SESSION"})
    return session


def bind_eoa_quote_identity(payload: dict, session: dict) -> dict:
    borrower = payload.get("borrower") or payload.get("accountWallet")
    position_wallet = payload.get("positionWallet") or payload.get("accountWallet")
    if not isinstance(borrower, str) or session["address"].lower() != borrower.lower():
        raise HTTPException(403, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    if not isinstance(position_wallet, str) or position_wallet.lower() != borrower.lower():
        raise HTTPException(422, detail={"code": "POSITION_WALLET_NOT_AUTHORIZED"})
    requested_chain = payload.get("chainId", settings.chain_id)
    if int(requested_chain) != settings.chain_id:
        raise HTTPException(422, detail={"code": "CHAIN_ID_MISMATCH"})
    return {
        **deepcopy(payload),
        "accountWallet": borrower,
        "borrower": borrower,
        "positionWallet": position_wallet,
        "chainId": settings.chain_id,
    }


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "mode": settings.normalized_mode, "database": "configured", "chainId": settings.chain_id}


@app.get("/api/v1/readiness")
async def readiness():
    database_ready = store.healthcheck()
    redis_ready = True
    if redis_client is not None:
        try:
            redis_ready = bool(await redis_client.ping())
        except RedisError:
            redis_ready = False
    ready = database_ready and redis_ready
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not-ready", "database": database_ready, "redis": redis_ready},
    )


@app.get("/api/v1/config/public")
def public_config():
    return {
        "mode": settings.normalized_mode,
        "chainId": settings.chain_id,
        "vaultAddress": settings.vault_address,
        "fundingPoolAddress": settings.funding_pool_address,
        "collateralTokenAddress": settings.collateral_token_address,
        "mainnetExecution": settings.execution_enabled,
        "dataSource": "seeded" if settings.normalized_mode in {"local", "test"} else "live",
    }


@app.post("/api/v1/auth/siwe/nonce")
def siwe_nonce():
    nonce = secrets.token_urlsafe(18)
    store.create_siwe_nonce(nonce, time.time() + 300)
    return {"nonce": nonce, "expiresIn": 300}


@app.post("/api/v1/auth/siwe/verify")
def siwe_verify(payload: dict):
    message = payload.get("message", "")
    signature = payload.get("signature", "")
    nonce = payload.get("nonce", "")
    now = time.time()
    if not store.consume_siwe_nonce(nonce, now):
        raise HTTPException(401, detail={"code": "INVALID_SIWE_NONCE"})
    lines = message.splitlines()
    fields = {
        line.split(": ", 1)[0]: line.split(": ", 1)[1]
        for line in lines
        if ": " in line
    }
    try:
        claimed_address = lines[1].strip()
        issued_at = datetime.fromisoformat(fields["Issued At"].replace("Z", "+00:00"))
        if (
            lines[0] != f"{settings.siwe_domain} wants you to sign in with your Ethereum account:"
            or fields.get("URI") != settings.siwe_uri
            or fields.get("Version") != "1"
            or int(fields.get("Chain ID", "0")) != settings.chain_id
            or fields.get("Nonce") != nonce
            or issued_at.tzinfo is None
            or issued_at.timestamp() > now + 60
            or issued_at.timestamp() < now - 600
        ):
            raise ValueError
        expiration = fields.get("Expiration Time")
        if expiration and datetime.fromisoformat(expiration.replace("Z", "+00:00")).timestamp() <= now:
            raise ValueError
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(401, detail={"code": "INVALID_SIWE_MESSAGE"}) from exc
    try:
        recovered = Account.recover_message(encode_defunct(text=message), signature=signature)
    except Exception as exc:
        raise HTTPException(401, detail={"code": "INVALID_SIWE_SIGNATURE"}) from exc
    if recovered.lower() != claimed_address.lower():
        raise HTTPException(401, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    token = secrets.token_urlsafe(32)
    store.create_session(token, recovered, time.time() + 3600)
    return {"sessionToken": token, "address": recovered, "expiresIn": 3600}


@app.post("/api/v1/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        store.revoke_session(authorization.removeprefix("Bearer "))
    return {"status": "logged-out"}


@app.get("/api/v1/auth/session")
def session(current: dict = Depends(authenticated_session)):
    return current


@app.get("/api/v1/markets")
async def markets():
    if settings.normalized_mode in {"local", "test"}:
        return {"data": store.list_markets(), "stale": False, "source": "seeded-local"}
    try:
        return {"data": await polymarket.markets(), "stale": False, "source": "gamma-live"}
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc


@app.get("/api/v1/markets/{condition_id}")
async def market(condition_id: str):
    if settings.normalized_mode in {"local", "test"}:
        item = store.get_market(condition_id)
    else:
        try:
            item = await polymarket.market(condition_id)
        except RuntimeError as exc:
            raise HTTPException(503, detail={"code": str(exc)}) from exc
    if not item:
        raise HTTPException(404, detail={"code": "MARKET_NOT_FOUND"})
    return item


@app.get("/api/v1/markets/{condition_id}/rules")
async def market_rules(condition_id: str):
    await market(condition_id)
    if settings.normalized_mode not in {"local", "test"}:
        relationship_matches = [
            item
            for item in store.list_relationships()
            if condition_id in item.get("marketConditionIds", []) and item.get("status") == "APPROVED"
        ]
        if not relationship_matches:
            raise HTTPException(404, detail={"code": "REVIEWED_RULES_NOT_FOUND"})
        return {
            "conditionId": condition_id,
            "ruleHash": relationship_matches[0]["resolutionRulesHash"],
            "source": "reviewed-relationship-repository",
            "observationSemanticsComplete": True,
        }
    return {
        "conditionId": condition_id,
        "ruleHash": "0x" + "cd" * 32,
        "source": "seeded-local-reviewed-rules",
        "observationSemanticsComplete": True,
    }


@app.get("/api/v1/markets/{condition_id}/snapshots")
async def market_snapshots(condition_id: str):
    item = await market(condition_id)
    token_ids = [str(token_id) for token_id in item.get("tokenIds", [])]
    if settings.normalized_mode in {"local", "test"}:
        snapshots = [
            snapshot
            for token_id in token_ids
            if (snapshot := store.get_market_snapshot(token_id)) is not None
        ]
        return {"data": snapshots, "conditionId": condition_id, "stale": False, "source": "local-cache"}
    try:
        snapshots = await require_fresh_books(token_ids)
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc
    return {"data": snapshots, "conditionId": condition_id, "stale": False, "source": "clob-live"}


@app.get("/api/v1/tokens/{token_id}/history")
async def token_price_history(token_id: str, interval: str = "1d", fidelity: int = 5):
    try:
        return await polymarket.price_history(token_id, interval, fidelity)
    except RuntimeError as exc:
        input_errors = {
            "POLYMARKET_TOKEN_ID_INVALID",
            "POLYMARKET_HISTORY_INTERVAL_INVALID",
            "POLYMARKET_HISTORY_FIDELITY_INVALID",
        }
        raise HTTPException(422 if str(exc) in input_errors else 503, detail={"code": str(exc)}) from exc


async def require_fresh_books(token_ids: list[str]) -> list[dict]:
    unique = list(dict.fromkeys(token_ids))
    if not unique or len(unique) > 20:
        raise RuntimeError("POLYMARKET_BOOK_TOKEN_SET_INVALID")
    fetched = await asyncio.gather(
        *(polymarket.order_book(token_id) for token_id in unique),
        return_exceptions=True,
    )
    snapshots: list[dict] = []
    now = time.time()
    for token_id, result in zip(unique, fetched, strict=True):
        if isinstance(result, Exception):
            cached = store.get_market_snapshot(token_id)
            if cached is None:
                raise RuntimeError("POLYMARKET_READ_UNAVAILABLE") from result
            cached["stale"] = now - float(cached.get("observedAt", 0)) > settings.market_freshness_seconds
            cached["source"] = "clob-persistent-cache"
            snapshots.append(cached)
            continue
        store.save_market_snapshot(result["tokenId"], result)
        snapshots.append(result)
    if any(snapshot["stale"] for snapshot in snapshots):
        raise RuntimeError("POLYMARKET_MARKET_DATA_STALE")
    return snapshots


@app.get("/api/v1/wallets/{address}")
async def wallet(address: str):
    if settings.normalized_mode in {"local", "test"}:
        return {
            "signerAddress": address,
            "positionWallet": address,
            "walletType": "EOA",
            "executionSupported": True,
            "source": "seeded-local",
        }
    try:
        return await polymarket.wallet_type(address)
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc


@app.get("/api/v1/wallets/{address}/positions")
async def positions(address: str):
    if settings.normalized_mode in {"local", "test"}:
        return {"signerAddress": address, "positionWallet": address, "walletType": "EOA", "positions": POSITIONS, "source": "seeded-local"}
    try:
        capability = await polymarket.wallet_type(address)
        return {**capability, "positions": await polymarket.positions(address), "source": "data-api-live"}
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc


@app.get("/api/v1/wallets/{address}/capabilities")
async def wallet_capabilities(address: str):
    return await wallet(address)


@app.get("/api/v1/wallets/{address}/eligible-bundles")
def eligible(address: str):
    if settings.normalized_mode not in {"local", "test"}:
        return {
            "accountWallet": address,
            "candidates": [],
            "reason": "REVIEWED_RELATIONSHIP_MATCH_REQUIRED",
            "source": "live",
        }
    return {"accountWallet": address, "candidates": [{"relationshipId": "btc-close-ladder", "status": "ELIGIBLE", "guaranteedFloorAtomic": "100000000", "estimatedAdvanceAtomic": "93500000"}]}


@app.get("/api/v1/wallets/{address}/opportunities")
def opportunities(address: str):
    if settings.normalized_mode not in {"local", "test"}:
        return {"positionWallet": address, "candidates": [], "reason": "REVIEWED_RELATIONSHIP_MATCH_REQUIRED"}
    return eligible(address)


@app.post("/api/v1/bundles/analyze")
def analyze(request: SolverRequest):
    result = solve(request)
    if not result.isSatisfiable:
        raise HTTPException(422, detail={"code": "SOLVER_REJECTED", "reasons": result.rejectionReasons})
    return result


@app.post("/api/v1/analysis")
def create_analysis(request: SolverRequest):
    result = solve(request)
    analysis_id = str(uuid.uuid4())
    artifact = ProofArtifact(request=request, result=result).model_dump(mode="json")
    record = {"id": analysis_id, "solverResult": result.model_dump(mode="json"), "artifact": artifact}
    store.save_analysis(analysis_id, record)
    return record


@app.get("/api/v1/analysis/{analysis_id}")
def get_analysis(analysis_id: str):
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(404, detail={"code": "ANALYSIS_NOT_FOUND"})
    return {key: value for key, value in record.items() if key != "artifact"}


@app.get("/api/v1/analysis/{analysis_id}/artifact")
def get_analysis_artifact(analysis_id: str):
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(404, detail={"code": "ANALYSIS_NOT_FOUND"})
    return record["artifact"]


@app.post("/api/v1/analysis/{analysis_id}/verify")
def verify_analysis(analysis_id: str):
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(404, detail={"code": "ANALYSIS_NOT_FOUND"})
    artifact = ProofArtifact.model_validate(record["artifact"])
    reproduced = solve(artifact.request, timestamp=artifact.result.generatedAt)
    return {"analysisId": analysis_id, "valid": reproduced == artifact.result, "artifactHash": artifact.result.artifactHash}


@app.post("/api/v1/quotes")
async def quote(payload: dict, current: dict = Depends(authenticated_session)):
    if settings.normalized_mode == "production-readonly":
        raise HTTPException(403, detail={"code": "PRODUCTION_READONLY"})
    payload = bind_eoa_quote_identity(payload, current)
    relationship = store.get_relationship_by_hash(
        payload.get("solverRequest", {}).get("relationshipDefinitionHash", "")
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(422, detail={"code": "RELATIONSHIP_NOT_ACTIVE"})
    trusted_definition = relationship.get("solverDefinition")
    if not trusted_definition:
        raise HTTPException(422, detail={"code": "REVIEWED_SOLVER_DEFINITION_MISSING"})
    trusted_payload = deepcopy(payload)
    trusted_payload["earliestResolutionTimestamp"] = relationship["earliestResolutionTimestamp"]
    trusted_payload["latestResolutionTimestamp"] = relationship["latestResolutionTimestamp"]
    trusted_payload["solverRequest"] = {
        **trusted_payload.get("solverRequest", {}),
        "relationshipDefinitionHash": relationship["canonicalDefinitionHash"],
        "definitionVersion": relationship["version"],
        "payoutModel": trusted_definition,
    }
    if settings.normalized_mode not in {"local", "test"}:
        token_ids = [
            str(leg.get("tokenId", ""))
            for leg in trusted_payload.get("solverRequest", {}).get("legs", [])
            if isinstance(leg, dict)
        ]
        try:
            await require_fresh_books(token_ids)
        except RuntimeError as exc:
            raise HTTPException(503, detail={"code": str(exc)}) from exc
    try:
        result = issue_quote(trusted_payload, settings, store.allocate_quote_nonce())
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, detail={"code": "QUOTE_REJECTED", "reason": str(exc)}) from exc
    store.save_quote(result["id"], result)
    return result


@app.get("/api/v1/quotes/{quote_id}")
def get_quote(quote_id: str):
    result = store.get_quote(quote_id)
    if result is None:
        raise HTTPException(404, detail={"code": "QUOTE_NOT_FOUND"})
    return result


@app.post("/api/v1/quotes/{quote_id}/refresh")
async def refresh_quote(quote_id: str, current: dict = Depends(authenticated_session)):
    previous = store.get_quote(quote_id)
    if previous is None:
        raise HTTPException(404, detail={"code": "QUOTE_NOT_FOUND"})
    if settings.normalized_mode == "production-readonly":
        raise HTTPException(403, detail={"code": "PRODUCTION_READONLY"})
    trusted_previous_payload = bind_eoa_quote_identity(previous["requestPayload"], current)
    relationship = store.get_relationship_by_hash(
        trusted_previous_payload.get("solverRequest", {}).get("relationshipDefinitionHash", "")
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(422, detail={"code": "RELATIONSHIP_NOT_ACTIVE"})
    trusted_previous_payload["earliestResolutionTimestamp"] = relationship[
        "earliestResolutionTimestamp"
    ]
    trusted_previous_payload["latestResolutionTimestamp"] = relationship[
        "latestResolutionTimestamp"
    ]
    if settings.normalized_mode not in {"local", "test"}:
        token_ids = [
            str(leg.get("tokenId", ""))
            for leg in trusted_previous_payload.get("solverRequest", {}).get("legs", [])
            if isinstance(leg, dict)
        ]
        try:
            await require_fresh_books(token_ids)
        except RuntimeError as exc:
            raise HTTPException(503, detail={"code": str(exc)}) from exc
    refreshed = issue_quote(trusted_previous_payload, settings, store.allocate_quote_nonce())
    store.save_quote(refreshed["id"], refreshed)
    return refreshed


@app.get("/api/v1/bundles")
def bundles():
    return {"data": store.list_bundles()}


@app.get("/api/v1/bundles/{bundle_id}")
def bundle(bundle_id: str):
    item = store.get_bundle(bundle_id)
    if not item:
        raise HTTPException(404, detail={"code": "BUNDLE_NOT_FOUND"})
    return item


@app.get("/api/v1/bundles/{bundle_id}/transactions")
def bundle_transactions(bundle_id: str):
    bundle(bundle_id)
    return {"bundleId": bundle_id, "data": []}


@app.post("/api/v1/bundles/{bundle_id}/prepare-settlement")
def prepare_settlement(bundle_id: str):
    bundle(bundle_id)
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "INDEXED_RESOLUTION_STATE_UNAVAILABLE"})
    return {"bundleId": bundle_id, "ready": False, "unresolvedConditions": ["btc-100", "btc-150"]}


@app.post("/api/v1/bundles/{bundle_id}/settle")
def settle(bundle_id: str):
    bundle(bundle_id)
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "INDEXED_RESOLUTION_STATE_UNAVAILABLE"})
    return {"bundleId": bundle_id, "transactionRequest": None, "reason": "CONDITIONS_UNRESOLVED"}


@app.get("/api/v1/claims")
def claims():
    return {"data": store.list_claims()}


@app.get("/api/v1/claims/{token_id}")
def claim(token_id: str):
    item = store.get_claim(token_id)
    if item is None:
        raise HTTPException(404, detail={"code": "CLAIM_NOT_FOUND"})
    return item


@app.post("/api/v1/claims/{token_id}/prepare-redemption")
def prepare_claim_redemption(token_id: str, payload: dict):
    item = claim(token_id)
    try:
        amount = int(payload["amountAtomic"])
        bundle_id = int(str(item["bundleId"]).removeprefix("EC-"))
        data = redeem_claim(item["claimType"], bundle_id, amount)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, detail={"code": "INVALID_REDEMPTION_REQUEST"}) from exc
    return {
        "claim": item,
        "amountAtomic": str(amount),
        "transactionRequest": {"to": settings.vault_address, "data": data, "value": "0x0"},
        "requiresWalletEncoding": False,
    }


@app.get("/api/v1/relationships")
def relationships():
    return {"data": store.list_relationships()}


@app.get("/api/v1/relationships/{relationship_id}")
def relationship(relationship_id: str):
    item = store.get_relationship(relationship_id)
    if not item:
        raise HTTPException(404, detail={"code": "RELATIONSHIP_NOT_FOUND"})
    return item


@app.post("/api/v1/admin/relationships")
def create_relationship(payload: dict, actor: str = Depends(admin)):
    if not payload.get("id"):
        raise HTTPException(422, detail={"code": "RELATIONSHIP_ID_REQUIRED"})
    item = {**payload, "status": "DRAFT"}
    try:
        store.create_relationship(item)
    except ValueError as exc:
        raise HTTPException(409, detail={"code": str(exc)}) from exc
    store.append_audit_log({"actor": actor, "action": "RELATIONSHIP_CREATED", "target": item["id"]})
    return item


@app.post("/api/v1/admin/relationships/{relationship_id}/{action}")
def relationship_action(relationship_id: str, action: str, actor: str = Depends(admin)):
    if action not in {"extract", "review", "approve", "suspend", "retire"}:
        raise HTTPException(404, detail={"code": "ACTION_NOT_FOUND"})
    current = store.get_relationship(relationship_id)
    if current is None:
        raise HTTPException(404, detail={"code": "RELATIONSHIP_NOT_FOUND"})
    allowed_transitions = {
        "extract": {"DRAFT"},
        "review": {"EXTRACTED"},
        "approve": {"REVIEW_REQUIRED", "SUSPENDED"},
        "suspend": {"APPROVED"},
        "retire": {"APPROVED", "SUSPENDED"},
    }
    if current["status"] not in allowed_transitions[action]:
        raise HTTPException(409, detail={"code": "INVALID_RELATIONSHIP_TRANSITION"})
    if action == "approve":
        required = {
            "canonicalDefinitionHash",
            "resolutionRulesHash",
            "solverDefinition",
            "marketConditionIds",
            "tokenIds",
            "version",
        }
        if any(not current.get(field) for field in required):
            raise HTTPException(422, detail={"code": "INCOMPLETE_REVIEWED_DEFINITION"})
        if current["solverDefinition"].get("definitionHash") != current["canonicalDefinitionHash"]:
            raise HTTPException(422, detail={"code": "SOLVER_DEFINITION_HASH_MISMATCH"})
    item = store.set_relationship_status(
        relationship_id,
        {
            "extract": "EXTRACTED",
            "review": "REVIEW_REQUIRED",
            "approve": "APPROVED",
            "suspend": "SUSPENDED",
            "retire": "RETIRED",
        }[action],
    )
    store.append_audit_log({"actor": actor, "action": f"RELATIONSHIP_{action.upper()}", "target": relationship_id})
    return item


@app.get("/api/v1/pool")
def pool():
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "INDEXED_POOL_STATE_UNAVAILABLE"})
    return {"totalAssetsAtomic": "1000000000", "liquidAtomic": "905000000", "outstandingAdvanceCostBasisAtomic": "95000000", "utilizationBps": 950, "realizedYieldAtomic": "0", "realizedLossAtomic": "0", "depositCapAtomic": "1000000000000", "source": "seeded-local"}


@app.get("/api/v1/pool/history")
def pool_history():
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "INDEXED_POOL_STATE_UNAVAILABLE"})
    return {"data": [{"date": "2026-07-27", "totalAssetsAtomic": "1000000000", "utilizationBps": 950}], "source": "seeded-local"}


@app.get("/api/v1/pool/account/{address}")
def pool_account(address: str):
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "INDEXED_POOL_ACCOUNT_UNAVAILABLE"})
    return {"address": address, "sharesAtomic": "0", "availableWithdrawalAtomic": "0", "allowlisted": False}


@app.post("/api/v1/pool/prepare-deposit")
def prepare_pool_deposit(payload: dict):
    try:
        amount = int(payload["amountAtomic"])
        receiver = payload["receiver"]
        data = deposit(amount, receiver)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, detail={"code": "INVALID_DEPOSIT_REQUEST"}) from exc
    return {"amountAtomic": str(amount), "transactionRequest": {"to": settings.funding_pool_address, "data": data, "value": "0x0"}, "allowlistRequired": True}


@app.post("/api/v1/pool/prepare-withdrawal")
def prepare_pool_withdrawal(payload: dict):
    try:
        amount = int(payload["amountAtomic"])
        receiver = payload["receiver"]
        owner = payload["owner"]
        data = withdraw(amount, receiver, owner)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, detail={"code": "INVALID_WITHDRAWAL_REQUEST"}) from exc
    return {"amountAtomic": str(amount), "transactionRequest": {"to": settings.funding_pool_address, "data": data, "value": "0x0"}}


@app.get("/api/v1/admin/risk")
def get_risk(_: str = Depends(admin)):
    return store.risk_policy if hasattr(store, "risk_policy") else {"source": "database"}


@app.post("/api/v1/admin/risk/{action}")
def risk_action(action: str, payload: dict, actor: str = Depends(admin)):
    if action not in {"propose", "execute"}:
        raise HTTPException(404, detail={"code": "ACTION_NOT_FOUND"})
    store.append_audit_log({"actor": actor, "action": f"RISK_{action.upper()}", "target": "risk-policy", "metadata": payload})
    return {"status": action.upper(), "proposal": payload}


@app.get("/api/v1/protocol/metrics")
def protocol_metrics():
    if settings.normalized_mode not in {"local", "test"}:
        bundles = store.list_bundles()
        relationships = store.list_relationships()
        if not bundles and not relationships:
            return {"available": False, "source": "indexed", "reason": "NO_VERIFIED_INDEXED_STATE"}
    bundles = store.list_bundles()
    relationships = store.list_relationships()
    active = [item for item in bundles if item["status"] == "ACTIVE"]
    return {
        "activeBundles": len(active),
        "settledBundles": sum(item["status"] == "SETTLED" for item in bundles),
        "shortfalls": sum(item["status"] == "SHORTFALL" for item in bundles),
        "guaranteedFloorEscrowedAtomic": str(sum(int(item["principalAmountAtomic"]) for item in active)),
        "grossAdvancesAtomic": str(sum(int(item.get("grossAdvanceAtomic", "0")) for item in bundles)),
        "netAdvancesAtomic": str(sum(int(item.get("netAdvanceAtomic", "0")) for item in bundles)),
        "approvedRelationships": sum(item["status"] == "APPROVED" for item in relationships),
        "source": "seeded-local" if settings.normalized_mode in {"local", "test"} else "indexed",
        "available": True,
    }


@app.get("/api/v1/protocol/events")
def protocol_events():
    return {"data": store.list_protocol_events()}


@app.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
