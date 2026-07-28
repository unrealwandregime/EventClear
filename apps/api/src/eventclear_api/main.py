from __future__ import annotations

import asyncio
import hashlib
import json
import os
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
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from redis.asyncio import from_url as redis_from_url
from redis.exceptions import RedisError
from eth_account import Account
from eth_account.messages import encode_defunct

from eventclear_solver.engine import solve
from eventclear_solver.models import ProofArtifact, SolverRequest

from .calldata import (
    deposit,
    open_bundle,
    redeem_claim,
    set_approval_for_all,
    settle_bundle,
    withdraw,
)
from .artifact_store import create_artifact_store
from .polymarket import PolymarketReadGateway
from .preflight import (
    QuotePreflightError,
    relationship_rejection_code,
    validate_quote_pre_sign,
)
from .quote import issue_quote
from .repository import create_store
from .seed import POSITIONS
from .settings import Settings
from .transaction_models import (
    AmountRequest,
    OpenBundleRequest,
    PoolDepositRequest,
    PoolWithdrawalRequest,
    PrepareOpenBundleRequest,
)

settings = Settings()
settings.validate()
store = create_store(settings)
artifact_store = create_artifact_store(settings)
redis_client = (
    redis_from_url(settings.redis_url, decode_responses=True)
    if settings.redis_url
    else None
)
polymarket = PolymarketReadGateway(
    settings.gamma_api_url,
    settings.data_api_url,
    settings.clob_api_url,
    settings.polygon_rpc_urls,
    freshness_seconds=settings.market_freshness_seconds,
)
REQUESTS = Counter(
    "eventclear_api_requests_total", "API requests", ["method", "path", "status"]
)
LATENCY = Histogram("eventclear_api_latency_seconds", "API request latency", ["path"])
QUOTE_REJECTIONS = Counter(
    "eventclear_quote_rejections_total", "Rejected quote preflights", ["code"]
)
POOL_LIQUID = Gauge(
    "eventclear_pool_liquid_assets", "Pool liquid assets in atomic units"
)
POOL_OUTSTANDING = Gauge(
    "eventclear_pool_outstanding_cost_basis",
    "Pool outstanding gross-advance cost basis in atomic units",
)
POOL_UTILIZATION = Gauge(
    "eventclear_pool_utilization_bps", "Pool utilization in basis points"
)
POOL_LP_YIELD = Gauge(
    "eventclear_pool_realized_lp_yield", "Cumulative realized LP yield in atomic units"
)
POOL_LOSSES = Gauge(
    "eventclear_pool_realized_losses", "Cumulative realized losses in atomic units"
)
rate_windows: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate()
    if settings.normalized_mode in {
        "staging",
        "production-readonly",
        "production-controlled",
    }:
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
    request.state.correlation_id = correlation_id
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    if redis_client is not None:
        try:
            rate_key = f"eventclear:rate:{key}:{int(time.time() // 60)}"
            count = await redis_client.incr(rate_key)
            if count == 1:
                await redis_client.expire(rate_key, 61)
            if count > 120:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "RATE_LIMITED",
                            "correlationId": correlation_id,
                        }
                    },
                )
        except RedisError:
            if settings.normalized_mode in {
                "staging",
                "production-readonly",
                "production-controlled",
            }:
                return JSONResponse(
                    status_code=503,
                    content={
                        "error": {
                            "code": "RATE_LIMITER_UNAVAILABLE",
                            "correlationId": correlation_id,
                        }
                    },
                )
    else:
        window = rate_windows[key]
        while window and window[0] < now - 60:
            window.popleft()
        if len(window) >= 120:
            return JSONResponse(
                status_code=429,
                content={
                    "error": {"code": "RATE_LIMITED", "correlationId": correlation_id}
                },
            )
        window.append(now)
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["content-security-policy"] = "default-src 'self'"
    REQUESTS.labels(request.method, request.url.path, response.status_code).inc()
    LATENCY.labels(request.url.path).observe(time.monotonic() - started)
    return response


def admin(
    x_admin_token: str | None = Header(default=None),
    x_admin_address: str | None = Header(default=None),
) -> str:
    if x_admin_token is None or not hmac.compare_digest(
        x_admin_token, settings.admin_api_token
    ):
        raise HTTPException(status_code=403, detail={"code": "ADMIN_REQUIRED"})
    if settings.normalized_mode == "staging" and (
        x_admin_address is None
        or x_admin_address.lower() not in settings.admin_allowlist
    ):
        raise HTTPException(status_code=403, detail={"code": "ADMIN_NOT_ALLOWLISTED"})
    return x_admin_address or "admin"


def authenticated_session(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, detail={"code": "SESSION_REQUIRED"})
    session = store.get_session(authorization.removeprefix("Bearer "), time.time())
    if session is None:
        raise HTTPException(401, detail={"code": "INVALID_SESSION"})
    if (
        settings.normalized_mode == "staging"
        and session["address"].lower() not in settings.tester_allowlist
    ):
        raise HTTPException(403, detail={"code": "TESTER_NOT_ALLOWLISTED"})
    return session


def bind_eoa_quote_identity(payload: dict, session: dict) -> dict:
    borrower = payload.get("borrower") or payload.get("accountWallet")
    position_wallet = payload.get("positionWallet") or payload.get("accountWallet")
    if not isinstance(borrower, str) or session["address"].lower() != borrower.lower():
        raise HTTPException(403, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    if (
        not isinstance(position_wallet, str)
        or position_wallet.lower() != borrower.lower()
    ):
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


def _correlation_id(request: Request) -> str:
    return str(getattr(request.state, "correlation_id", "unknown"))


def _idempotency_scope(key: str, action: str, actor: str) -> str:
    if not 8 <= len(key) <= 200:
        raise HTTPException(422, detail={"code": "IDEMPOTENCY_KEY_INVALID"})
    return hashlib.sha256(f"{actor.lower()}:{action}:{key}".encode()).hexdigest()


def _idempotent_cached(scope: str, payload: dict) -> dict | None:
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    previous = store.get_idempotency(scope)
    if previous is None:
        return None
    if previous["fingerprint"] != fingerprint:
        raise HTTPException(409, detail={"code": "IDEMPOTENCY_KEY_REUSED"})
    return previous["response"]


def _save_idempotent(scope: str, payload: dict, response: dict) -> None:
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    store.save_idempotency(scope, {"fingerprint": fingerprint, "response": response})


def _execution_enabled() -> None:
    if settings.normalized_mode == "production-readonly":
        raise HTTPException(403, detail={"code": "PRODUCTION_READONLY"})


async def _simulate(sender: str, transaction: dict, fallback_gas: int) -> dict:
    if polymarket.rpc_urls:
        try:
            return await polymarket.simulate_transaction(
                sender=sender,
                to=transaction["to"],
                data=transaction["data"],
                value=transaction["value"],
            )
        except RuntimeError as exc:
            code = str(exc)
            status = 422 if code.startswith("RPC_REVERTED:") else 503
            raise HTTPException(
                status, detail={"code": "TRANSACTION_SIMULATION_FAILED", "reason": code}
            ) from exc
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "TRANSACTION_SIMULATION_UNAVAILABLE"})
    return {"status": "LOCAL_DETERMINISTIC", "gasEstimate": str(fallback_gas)}


async def _approval_required(owner: str) -> bool:
    if polymarket.rpc_urls:
        approved = await polymarket.contract_call(
            settings.conditional_tokens_address,
            "isApprovedForAll(address,address)",
            ["address", "address"],
            [owner, settings.vault_address],
        )
        return not bool(approved)
    return not bool(
        getattr(store, "erc1155_approvals", {}).get(
            (owner.lower(), settings.vault_address.lower()),
            False,
        )
    )


async def _revalidate_saved_quote(quote_id: str, current: dict) -> tuple[dict, dict]:
    saved = store.get_quote(quote_id)
    if saved is None:
        raise HTTPException(404, detail={"code": "QUOTE_NOT_FOUND"})
    quote_message = saved["quote"]
    if quote_message["borrower"].lower() != current["address"].lower():
        raise HTTPException(403, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    if int(quote_message["chainId"]) != settings.chain_id:
        raise HTTPException(422, detail={"code": "CHAIN_ID_MISMATCH"})
    if int(quote_message["expiry"]) < int(time.time()):
        raise HTTPException(422, detail={"code": "QUOTE_EXPIRED"})
    relationship = store.get_relationship_by_hash(
        quote_message["relationshipDefinitionHash"]
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(
            422, detail={"code": relationship_rejection_code(relationship)}
        )
    try:
        await validate_quote_pre_sign(
            saved["requestPayload"],
            relationship,
            settings,
            store,
            polymarket,
            require_fresh_books,
        )
    except QuotePreflightError as exc:
        QUOTE_REJECTIONS.labels(code=exc.code).inc()
        raise HTTPException(422, detail={"code": exc.code}) from exc
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc
    return saved, relationship


@app.get("/api/v1/health")
def health():
    return {
        "status": "ok",
        "mode": settings.normalized_mode,
        "database": "configured",
        "chainId": settings.chain_id,
    }


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
        content={
            "status": "ready" if ready else "not-ready",
            "database": database_ready,
            "redis": redis_ready,
        },
    )


@app.get("/api/v1/config/public")
def public_config():
    read_only = settings.normalized_mode == "production-readonly"
    contracts_deployed = (
        settings.normalized_mode in {"local", "test", "polygon-fork"}
        or os.getenv("CONTRACTS_DEPLOYED") == "true"
    )
    return {
        "mode": settings.normalized_mode,
        "environment": settings.normalized_mode,
        "chainId": settings.chain_id,
        "vaultAddress": settings.vault_address,
        "fundingPoolAddress": settings.funding_pool_address,
        "collateralTokenAddress": settings.collateral_token_address,
        "conditionalTokensAddress": settings.conditional_tokens_address,
        "siweDomain": settings.siwe_domain,
        "siweUri": settings.siwe_uri,
        "mainnetExecution": settings.execution_enabled,
        "dataSource": "seeded"
        if settings.normalized_mode in {"local", "test"}
        else "live",
        "executionStatus": "Read-only" if read_only else "Controlled execution",
        "contractDeploymentStatus": "Deployed"
        if contracts_deployed
        else "Not deployed",
        "indexerStatus": (
            "Local fixture"
            if settings.normalized_mode in {"local", "test"}
            else "Not configured"
        ),
        "relationshipDatabaseStatus": (
            "Available" if store.healthcheck() else "Unavailable"
        ),
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
        line.split(": ", 1)[0]: line.split(": ", 1)[1] for line in lines if ": " in line
    }
    try:
        claimed_address = lines[1].strip()
        issued_at = datetime.fromisoformat(fields["Issued At"].replace("Z", "+00:00"))
        if (
            lines[0]
            != f"{settings.siwe_domain} wants you to sign in with your Ethereum account:"
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
        if (
            expiration
            and datetime.fromisoformat(expiration.replace("Z", "+00:00")).timestamp()
            <= now
        ):
            raise ValueError
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(401, detail={"code": "INVALID_SIWE_MESSAGE"}) from exc
    try:
        recovered = Account.recover_message(
            encode_defunct(text=message), signature=signature
        )
    except Exception as exc:
        raise HTTPException(401, detail={"code": "INVALID_SIWE_SIGNATURE"}) from exc
    if recovered.lower() != claimed_address.lower():
        raise HTTPException(401, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    if (
        settings.normalized_mode == "staging"
        and recovered.lower() not in settings.tester_allowlist
    ):
        raise HTTPException(403, detail={"code": "TESTER_NOT_ALLOWLISTED"})
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
        return {
            "data": await polymarket.markets(),
            "stale": False,
            "source": "gamma-live",
        }
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
            if condition_id in item.get("marketConditionIds", [])
            and item.get("status") == "APPROVED"
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
        return {
            "data": snapshots,
            "conditionId": condition_id,
            "stale": False,
            "source": "local-cache",
        }
    try:
        snapshots = await require_fresh_books(token_ids)
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc
    return {
        "data": snapshots,
        "conditionId": condition_id,
        "stale": False,
        "source": "clob-live",
    }


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
        raise HTTPException(
            422 if str(exc) in input_errors else 503, detail={"code": str(exc)}
        ) from exc


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
            cached["stale"] = (
                now - float(cached.get("observedAt", 0))
                > settings.market_freshness_seconds
            )
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
        return {
            "signerAddress": address,
            "positionWallet": address,
            "walletType": "EOA",
            "positions": POSITIONS,
            "source": "seeded-local",
        }
    try:
        capability = await polymarket.wallet_type(address)
        return {
            **capability,
            "positions": await polymarket.positions(address),
            "source": "data-api-live",
        }
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
    return {
        "accountWallet": address,
        "candidates": [
            {
                "relationshipId": "btc-close-ladder",
                "status": "ELIGIBLE",
                "guaranteedFloorAtomic": "100000000",
                "estimatedAdvanceAtomic": "93500000",
            }
        ],
    }


@app.get("/api/v1/wallets/{address}/opportunities")
def opportunities(address: str):
    if settings.normalized_mode not in {"local", "test"}:
        return {
            "positionWallet": address,
            "candidates": [],
            "reason": "REVIEWED_RELATIONSHIP_MATCH_REQUIRED",
        }
    return eligible(address)


@app.post("/api/v1/bundles/analyze")
def analyze(request: SolverRequest):
    result = solve(request)
    if not result.isSatisfiable:
        raise HTTPException(
            422, detail={"code": "SOLVER_REJECTED", "reasons": result.rejectionReasons}
        )
    return result


@app.post("/api/v1/analysis")
def create_analysis(payload: dict, current: dict = Depends(authenticated_session)):
    bound = bind_eoa_quote_identity(payload, current)
    submitted = bound.get("solverRequest", {})
    relationship = store.get_relationship_by_hash(
        submitted.get("relationshipDefinitionHash", "")
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(
            422, detail={"code": relationship_rejection_code(relationship)}
        )
    definition = relationship.get("solverDefinition")
    if not definition:
        raise HTTPException(422, detail={"code": "REVIEWED_SOLVER_DEFINITION_MISSING"})
    request = SolverRequest.model_validate(
        {
            **submitted,
            "relationshipDefinitionHash": relationship["canonicalDefinitionHash"],
            "definitionVersion": relationship["version"],
            "payoutModel": definition,
        }
    )
    result = solve(request)
    if not result.financingEligible:
        raise HTTPException(
            422,
            detail={"code": "SOLVER_REJECTED", "reasons": result.rejectionCodes},
        )
    analysis_id = str(uuid.uuid4())
    artifact = ProofArtifact(request=request, result=result).model_dump(mode="json")
    record = {
        "id": analysis_id,
        "solverResult": result.model_dump(mode="json"),
        "artifact": artifact,
        "relationship": {
            "id": relationship["id"],
            "version": relationship["version"],
            "ruleDocumentHash": relationship["resolutionRulesHash"],
            "earliestResolutionTimestamp": relationship["earliestResolutionTimestamp"],
            "latestResolutionTimestamp": relationship["latestResolutionTimestamp"],
        },
    }
    if artifact_store is not None:
        stored = artifact_store.put(analysis_id, artifact)
        record["artifactObjectKey"] = stored.key
        record["artifactStorageHash"] = stored.sha256
        del record["artifact"]
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
    if artifact_store is not None:
        return artifact_store.get(
            record["artifactObjectKey"], record["artifactStorageHash"]
        )
    return record["artifact"]


@app.post("/api/v1/analysis/{analysis_id}/verify")
def verify_analysis(analysis_id: str):
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(404, detail={"code": "ANALYSIS_NOT_FOUND"})
    stored_artifact = (
        artifact_store.get(record["artifactObjectKey"], record["artifactStorageHash"])
        if artifact_store is not None
        else record["artifact"]
    )
    artifact = ProofArtifact.model_validate(stored_artifact)
    reproduced = solve(artifact.request, timestamp=artifact.result.generatedAt)
    return {
        "analysisId": analysis_id,
        "valid": reproduced == artifact.result,
        "artifactHash": artifact.result.artifactHash,
    }


@app.post("/api/v1/quotes")
async def quote(payload: dict, current: dict = Depends(authenticated_session)):
    if settings.normalized_mode == "production-readonly":
        raise HTTPException(403, detail={"code": "PRODUCTION_READONLY"})
    payload = bind_eoa_quote_identity(payload, current)
    relationship = store.get_relationship_by_hash(
        payload.get("solverRequest", {}).get("relationshipDefinitionHash", "")
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(
            422, detail={"code": relationship_rejection_code(relationship)}
        )
    trusted_definition = relationship.get("solverDefinition")
    if not trusted_definition:
        raise HTTPException(422, detail={"code": "REVIEWED_SOLVER_DEFINITION_MISSING"})
    trusted_payload = deepcopy(payload)
    trusted_payload["earliestResolutionTimestamp"] = relationship[
        "earliestResolutionTimestamp"
    ]
    trusted_payload["latestResolutionTimestamp"] = relationship[
        "latestResolutionTimestamp"
    ]
    trusted_payload["solverRequest"] = {
        **trusted_payload.get("solverRequest", {}),
        "relationshipDefinitionHash": relationship["canonicalDefinitionHash"],
        "definitionVersion": relationship["version"],
        "payoutModel": trusted_definition,
    }
    try:
        preflight = await validate_quote_pre_sign(
            trusted_payload,
            relationship,
            settings,
            store,
            polymarket,
            require_fresh_books,
        )
        result = issue_quote(
            trusted_payload,
            settings,
            store.allocate_quote_nonce(),
            solver_timestamp=preflight["solverTimestamp"],
        )
        if result["solverResult"]["artifactHash"] != preflight["artifactHash"]:
            raise QuotePreflightError("SOLVER_ARTIFACT_CHANGED_BEFORE_SIGNING")
        result["preSignValidation"] = preflight
    except QuotePreflightError as exc:
        QUOTE_REJECTIONS.labels(code=exc.code).inc()
        raise HTTPException(422, detail={"code": exc.code}) from exc
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            422, detail={"code": "QUOTE_REJECTED", "reason": str(exc)}
        ) from exc
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
    trusted_previous_payload = bind_eoa_quote_identity(
        previous["requestPayload"], current
    )
    relationship = store.get_relationship_by_hash(
        trusted_previous_payload.get("solverRequest", {}).get(
            "relationshipDefinitionHash", ""
        )
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(
            422, detail={"code": relationship_rejection_code(relationship)}
        )
    trusted_previous_payload["earliestResolutionTimestamp"] = relationship[
        "earliestResolutionTimestamp"
    ]
    trusted_previous_payload["latestResolutionTimestamp"] = relationship[
        "latestResolutionTimestamp"
    ]
    trusted_definition = relationship.get("solverDefinition")
    if not trusted_definition:
        raise HTTPException(422, detail={"code": "REVIEWED_SOLVER_DEFINITION_MISSING"})
    trusted_previous_payload["solverRequest"] = {
        **trusted_previous_payload.get("solverRequest", {}),
        "relationshipDefinitionHash": relationship["canonicalDefinitionHash"],
        "definitionVersion": relationship["version"],
        "payoutModel": trusted_definition,
    }
    try:
        preflight = await validate_quote_pre_sign(
            trusted_previous_payload,
            relationship,
            settings,
            store,
            polymarket,
            require_fresh_books,
        )
        refreshed = issue_quote(
            trusted_previous_payload,
            settings,
            store.allocate_quote_nonce(),
            solver_timestamp=preflight["solverTimestamp"],
        )
        if refreshed["solverResult"]["artifactHash"] != preflight["artifactHash"]:
            raise QuotePreflightError("SOLVER_ARTIFACT_CHANGED_BEFORE_SIGNING")
        refreshed["preSignValidation"] = preflight
    except QuotePreflightError as exc:
        QUOTE_REJECTIONS.labels(code=exc.code).inc()
        raise HTTPException(422, detail={"code": exc.code}) from exc
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            422, detail={"code": "QUOTE_REJECTED", "reason": str(exc)}
        ) from exc
    store.save_quote(refreshed["id"], refreshed)
    return refreshed


@app.post("/api/v1/bundles/open/preflight")
async def open_bundle_preflight(
    payload: OpenBundleRequest,
    request: Request,
    current: dict = Depends(authenticated_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _execution_enabled()
    scope = _idempotency_scope(
        idempotency_key, "OPEN_BUNDLE_PREFLIGHT", current["address"]
    )
    body = payload.model_dump()
    cached = _idempotent_cached(scope, body)
    if cached is not None:
        return cached
    saved, relationship = await _revalidate_saved_quote(payload.quoteId, current)
    approval_required = await _approval_required(current["address"])
    response = {
        "quoteId": payload.quoteId,
        "chainId": settings.chain_id,
        "borrower": current["address"],
        "positionWallet": saved["quote"]["positionWallet"],
        "relationshipVersion": relationship["version"],
        "quoteExpiry": saved["quote"]["expiry"],
        "approvalRequired": approval_required,
        "approvalTarget": settings.conditional_tokens_address,
        "approvalOperator": settings.vault_address,
        "checks": {
            "session": True,
            "quote": True,
            "positions": True,
            "pool": True,
            "risk": True,
        },
        "correlationId": _correlation_id(request),
    }
    _save_idempotent(scope, body, response)
    store.append_audit_log(
        {
            "actor": current["address"],
            "action": "OPEN_BUNDLE_PREFLIGHT",
            "target": payload.quoteId,
            "metadata": {"correlationId": _correlation_id(request)},
        }
    )
    return response


@app.post("/api/v1/bundles/open/prepare")
async def prepare_open_bundle(
    payload: PrepareOpenBundleRequest,
    request: Request,
    current: dict = Depends(authenticated_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _execution_enabled()
    scope = _idempotency_scope(
        idempotency_key, "PREPARE_OPEN_BUNDLE", current["address"]
    )
    body = payload.model_dump()
    cached = _idempotent_cached(scope, body)
    if cached is not None:
        return cached
    saved, relationship = await _revalidate_saved_quote(payload.quoteId, current)
    approval_required = await _approval_required(current["address"])
    if approval_required:
        data = set_approval_for_all(settings.vault_address)
        transaction = {
            "to": settings.conditional_tokens_address,
            "data": data,
            "value": "0x0",
        }
        action = "APPROVE_POSITIONS"
        fallback_gas = 80_000
    else:
        legs = saved["requestPayload"]["solverRequest"]["legs"]
        data = open_bundle(
            saved["quote"],
            saved["signature"],
            saved["walletAuthorization"]["authorization"],
            payload.walletAuthorizationSignature,
            legs,
            relationship["version"],
        )
        transaction = {"to": settings.vault_address, "data": data, "value": "0x0"}
        action = "OPEN_BUNDLE"
        fallback_gas = 900_000
    simulation = await _simulate(current["address"], transaction, fallback_gas)
    response = {
        "action": action,
        "quoteId": payload.quoteId,
        "chainId": settings.chain_id,
        "expectedSelector": data[:10],
        "transactionRequest": transaction,
        "simulation": simulation,
        "correlationId": _correlation_id(request),
    }
    _save_idempotent(scope, body, response)
    store.append_audit_log(
        {
            "actor": current["address"],
            "action": action,
            "target": payload.quoteId,
            "metadata": {
                "correlationId": _correlation_id(request),
                "selector": data[:10],
            },
        }
    )
    return response


@app.get("/api/v1/bundles")
def bundles():
    return {"data": store.list_bundles()}


@app.get("/api/v1/bundles/{bundle_id}")
def bundle(bundle_id: str):
    item = store.get_bundle(bundle_id)
    if not item:
        raise HTTPException(404, detail={"code": "BUNDLE_NOT_FOUND"})
    condition_ids = item.get("conditionIds", [])
    token_ids = item.get("tokenIds", [])
    amounts = item.get("amounts", [])
    outcomes = item.get("outcomes", [])
    legs = item.get("legs") or [
        {
            "conditionId": str(condition_id),
            "tokenId": str(token_ids[index]) if index < len(token_ids) else "",
            "outcome": str(outcomes[index]) if index < len(outcomes) else None,
            "amountAtomic": str(amounts[index]) if index < len(amounts) else "0",
        }
        for index, condition_id in enumerate(condition_ids)
    ]
    onchain_id = str(item.get("onchainBundleId", bundle_id))
    matching_claims = [
        claim_item
        for claim_item in store.list_claims()
        if str(claim_item.get("bundleId")) in {bundle_id, onchain_id}
    ]
    event_history = item.get("eventHistory") or [
        event
        for event in store.list_protocol_events()
        if str(event.get("payload", {}).get("bundleId")) in {bundle_id, onchain_id}
    ]
    return {
        **item,
        "legs": legs,
        "claims": matching_claims,
        "events": event_history,
    }


@app.get("/api/v1/bundles/{bundle_id}/transactions")
def bundle_transactions(bundle_id: str):
    bundle(bundle_id)
    return {"bundleId": bundle_id, "data": []}


@app.post("/api/v1/bundles/{bundle_id}/prepare-settlement")
async def prepare_settlement(
    bundle_id: str,
    request: Request,
    current: dict = Depends(authenticated_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _execution_enabled()
    item = bundle(bundle_id)
    if item["status"] != "ACTIVE":
        raise HTTPException(409, detail={"code": "BUNDLE_NOT_ACTIVE"})
    if not item.get("conditionsResolved"):
        raise HTTPException(
            409,
            detail={
                "code": "CONDITIONS_UNRESOLVED",
                "unresolvedConditions": item.get("unresolvedConditions", []),
            },
        )
    onchain_id = item.get("onchainBundleId")
    if onchain_id is None:
        raise HTTPException(503, detail={"code": "INDEXED_BUNDLE_ID_UNAVAILABLE"})
    scope = _idempotency_scope(
        idempotency_key, "PREPARE_SETTLEMENT", current["address"]
    )
    body = {"bundleId": bundle_id}
    cached = _idempotent_cached(scope, body)
    if cached is not None:
        return cached
    data = settle_bundle(int(onchain_id))
    transaction = {"to": settings.vault_address, "data": data, "value": "0x0"}
    response = {
        "action": "SETTLE_BUNDLE",
        "bundleId": bundle_id,
        "chainId": settings.chain_id,
        "expectedSelector": data[:10],
        "transactionRequest": transaction,
        "simulation": await _simulate(current["address"], transaction, 650_000),
        "correlationId": _correlation_id(request),
    }
    _save_idempotent(scope, body, response)
    store.append_audit_log(
        {
            "actor": current["address"],
            "action": "PREPARE_SETTLEMENT",
            "target": bundle_id,
            "metadata": {"correlationId": _correlation_id(request)},
        }
    )
    return response


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
async def prepare_claim_redemption(
    token_id: str,
    payload: AmountRequest,
    request: Request,
    current: dict = Depends(authenticated_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _execution_enabled()
    item = claim(token_id)
    balances = item.get("balances")
    indexed_balance = str(
        balances.get(current["address"].lower(), "0")
        if isinstance(balances, dict)
        else item.get("holderBalanceAtomic", "0")
    )
    holder_balance = indexed_balance
    if (
        item.get("holderAddress")
        and str(item["holderAddress"]).lower() != current["address"].lower()
    ):
        raise HTTPException(403, detail={"code": "CLAIM_HOLDER_MISMATCH"})
    try:
        amount = int(payload.amountAtomic)
        if amount > int(holder_balance):
            raise ValueError("balance")
        bundle_id = int(str(item["bundleId"]).removeprefix("EC-"))
        data = redeem_claim(item["claimType"], bundle_id, amount)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, detail={"code": "INVALID_REDEMPTION_REQUEST"}) from exc
    scope = _idempotency_scope(
        idempotency_key, "PREPARE_CLAIM_REDEMPTION", current["address"]
    )
    body = {"tokenId": token_id, **payload.model_dump()}
    cached = _idempotent_cached(scope, body)
    if cached is not None:
        return cached
    transaction = {"to": settings.vault_address, "data": data, "value": "0x0"}
    response = {
        "action": f"REDEEM_{item['claimType']}",
        "chainId": settings.chain_id,
        "expectedSelector": data[:10],
        "claim": item,
        "amountAtomic": str(amount),
        "transactionRequest": transaction,
        "simulation": await _simulate(current["address"], transaction, 220_000),
        "correlationId": _correlation_id(request),
        "requiresWalletEncoding": False,
    }
    _save_idempotent(scope, body, response)
    store.append_audit_log(
        {
            "actor": current["address"],
            "action": "PREPARE_CLAIM_REDEMPTION",
            "target": token_id,
            "metadata": {"correlationId": _correlation_id(request)},
        }
    )
    return response


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
    store.append_audit_log(
        {"actor": actor, "action": "RELATIONSHIP_CREATED", "target": item["id"]}
    )
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
        if (
            current["solverDefinition"].get("definitionHash")
            != current["canonicalDefinitionHash"]
        ):
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
    store.append_audit_log(
        {
            "actor": actor,
            "action": f"RELATIONSHIP_{action.upper()}",
            "target": relationship_id,
        }
    )
    return item


@app.get("/api/v1/pool")
def pool():
    if settings.normalized_mode not in {"local", "test"}:
        indexed = store.get_pool_state()
        if indexed is None:
            raise HTTPException(503, detail={"code": "INDEXED_POOL_STATE_UNAVAILABLE"})
        response = indexed
    else:
        response = {
            "totalAssetsAtomic": "1000000000",
            "liquidAtomic": "905475000",
            "outstandingAdvanceCostBasisAtomic": "95000000",
            "outstandingQuotedFeesAtomic": "475000",
            "utilizationBps": 950,
            "realizedOriginationFeesAtomic": "0",
            "realizedGrossFinancingReturnAtomic": "0",
            "realizedLpYieldAtomic": "0",
            "realizedProtocolYieldFeesAtomic": "0",
            "refundedQuotedFeesAtomic": "0",
            "realizedLossAtomic": "0",
            "depositCapAtomic": "1000000000000",
            "source": "seeded-local",
        }
    POOL_LIQUID.set(int(response.get("liquidAtomic", "0")))
    POOL_OUTSTANDING.set(int(response.get("outstandingAdvanceCostBasisAtomic", "0")))
    POOL_UTILIZATION.set(int(response.get("utilizationBps", 0)))
    POOL_LP_YIELD.set(int(response.get("realizedLpYieldAtomic", "0")))
    POOL_LOSSES.set(int(response.get("realizedLossAtomic", "0")))
    return response


@app.get("/api/v1/pool/history")
def pool_history():
    if settings.normalized_mode not in {"local", "test"}:
        raise HTTPException(503, detail={"code": "INDEXED_POOL_STATE_UNAVAILABLE"})
    return {
        "data": [
            {
                "date": "2026-07-27",
                "totalAssetsAtomic": "1000000000",
                "utilizationBps": 950,
            }
        ],
        "source": "seeded-local",
    }


@app.get("/api/v1/pool/account/{address}")
def pool_account(address: str):
    if settings.normalized_mode not in {"local", "test"}:
        indexed = store.get_pool_account(address)
        if indexed is None:
            return {
                "address": address,
                "sharesAtomic": "0",
                "availableWithdrawalAtomic": "0",
                "allowlisted": False,
                "source": "indexed",
            }
        return {
            **indexed,
            "allowlisted": address.lower() in settings.lp_allowlist,
        }
    return {
        "address": address,
        "sharesAtomic": "0",
        "availableWithdrawalAtomic": "0",
        "allowlisted": address.lower() in getattr(store, "lp_allowlist", set()),
    }


@app.post("/api/v1/pool/prepare-deposit")
async def prepare_pool_deposit(
    payload: PoolDepositRequest,
    request: Request,
    current: dict = Depends(authenticated_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _execution_enabled()
    if payload.receiver.lower() != current["address"].lower():
        raise HTTPException(403, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    account = pool_account(current["address"])
    if not account["allowlisted"]:
        raise HTTPException(403, detail={"code": "LP_NOT_ALLOWLISTED"})
    amount = int(payload.amountAtomic)
    data = deposit(amount, payload.receiver)
    scope = _idempotency_scope(
        idempotency_key, "PREPARE_POOL_DEPOSIT", current["address"]
    )
    body = payload.model_dump()
    cached = _idempotent_cached(scope, body)
    if cached is not None:
        return cached
    transaction = {"to": settings.funding_pool_address, "data": data, "value": "0x0"}
    response = {
        "action": "POOL_DEPOSIT",
        "amountAtomic": str(amount),
        "chainId": settings.chain_id,
        "expectedSelector": data[:10],
        "transactionRequest": transaction,
        "simulation": await _simulate(current["address"], transaction, 180_000),
        "correlationId": _correlation_id(request),
        "allowlistRequired": True,
    }
    _save_idempotent(scope, body, response)
    store.append_audit_log(
        {
            "actor": current["address"],
            "action": "PREPARE_POOL_DEPOSIT",
            "target": settings.funding_pool_address,
            "metadata": {"correlationId": _correlation_id(request)},
        }
    )
    return response


@app.post("/api/v1/pool/prepare-withdrawal")
async def prepare_pool_withdrawal(
    payload: PoolWithdrawalRequest,
    request: Request,
    current: dict = Depends(authenticated_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _execution_enabled()
    if (
        payload.owner.lower() != current["address"].lower()
        or payload.receiver.lower() != current["address"].lower()
    ):
        raise HTTPException(403, detail={"code": "SIWE_ADDRESS_MISMATCH"})
    account = pool_account(current["address"])
    amount = int(payload.amountAtomic)
    if amount > int(account["availableWithdrawalAtomic"]):
        raise HTTPException(422, detail={"code": "WITHDRAWAL_AMOUNT_UNAVAILABLE"})
    data = withdraw(amount, payload.receiver, payload.owner)
    scope = _idempotency_scope(
        idempotency_key, "PREPARE_POOL_WITHDRAWAL", current["address"]
    )
    body = payload.model_dump()
    cached = _idempotent_cached(scope, body)
    if cached is not None:
        return cached
    transaction = {"to": settings.funding_pool_address, "data": data, "value": "0x0"}
    response = {
        "action": "POOL_WITHDRAWAL",
        "amountAtomic": str(amount),
        "chainId": settings.chain_id,
        "expectedSelector": data[:10],
        "transactionRequest": transaction,
        "simulation": await _simulate(current["address"], transaction, 180_000),
        "correlationId": _correlation_id(request),
    }
    _save_idempotent(scope, body, response)
    store.append_audit_log(
        {
            "actor": current["address"],
            "action": "PREPARE_POOL_WITHDRAWAL",
            "target": settings.funding_pool_address,
            "metadata": {"correlationId": _correlation_id(request)},
        }
    )
    return response


@app.get("/api/v1/admin/risk")
def get_risk(_: str = Depends(admin)):
    return (
        store.risk_policy if hasattr(store, "risk_policy") else {"source": "database"}
    )


@app.post("/api/v1/admin/risk/{action}")
def risk_action(action: str, payload: dict, actor: str = Depends(admin)):
    if action not in {"propose", "execute"}:
        raise HTTPException(404, detail={"code": "ACTION_NOT_FOUND"})
    store.append_audit_log(
        {
            "actor": actor,
            "action": f"RISK_{action.upper()}",
            "target": "risk-policy",
            "metadata": payload,
        }
    )
    return {"status": action.upper(), "proposal": payload}


@app.get("/api/v1/protocol/metrics")
def protocol_metrics():
    if settings.normalized_mode not in {"local", "test"}:
        bundles = store.list_bundles()
        relationships = store.list_relationships()
        if not bundles and not relationships:
            return {
                "available": False,
                "source": "indexed",
                "reason": "NO_VERIFIED_INDEXED_STATE",
            }
    bundles = store.list_bundles()
    relationships = store.list_relationships()
    active = [item for item in bundles if item["status"] == "ACTIVE"]
    return {
        "activeBundles": len(active),
        "settledBundles": sum(item["status"] == "SETTLED" for item in bundles),
        "shortfalls": sum(item["status"] == "SHORTFALL" for item in bundles),
        "guaranteedFloorEscrowedAtomic": str(
            sum(int(item["principalAmountAtomic"]) for item in active)
        ),
        "grossAdvancesAtomic": str(
            sum(int(item.get("grossAdvanceAtomic", "0")) for item in bundles)
        ),
        "netAdvancesAtomic": str(
            sum(int(item.get("netAdvanceAtomic", "0")) for item in bundles)
        ),
        "approvedRelationships": sum(
            item["status"] == "APPROVED" for item in relationships
        ),
        "source": "seeded-local"
        if settings.normalized_mode in {"local", "test"}
        else "indexed",
        "available": True,
    }


@app.get("/api/v1/protocol/events")
def protocol_events():
    return {"data": store.list_protocol_events()}


@app.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
