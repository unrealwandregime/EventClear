from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OpenBundleRequest(StrictModel):
    quoteId: str = Field(min_length=1)


class PrepareOpenBundleRequest(OpenBundleRequest):
    walletAuthorizationSignature: str

    @field_validator("walletAuthorizationSignature")
    @classmethod
    def signature_is_65_bytes(cls, value: str) -> str:
        if not value.startswith("0x") or len(value) != 132:
            raise ValueError("wallet authorization signature must be 65 bytes")
        int(value[2:], 16)
        return value


class AmountRequest(StrictModel):
    amountAtomic: str

    @field_validator("amountAtomic")
    @classmethod
    def positive_amount(cls, value: str) -> str:
        if not value.isdigit() or int(value) <= 0:
            raise ValueError("amount must be a positive integer")
        return value


class PoolDepositRequest(AmountRequest):
    receiver: str


class PoolWithdrawalRequest(AmountRequest):
    receiver: str
    owner: str


class TransactionRequest(StrictModel):
    to: str
    data: str
    value: str = "0x0"


class SimulationResult(StrictModel):
    status: str
    gasEstimate: str


class PreparedTransaction(StrictModel):
    action: str
    chainId: int
    expectedSelector: str
    transactionRequest: TransactionRequest
    simulation: SimulationResult
    correlationId: str
