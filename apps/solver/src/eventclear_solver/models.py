from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


Atomic = str


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Leg(StrictModel):
    conditionId: str = Field(min_length=3)
    tokenId: str = Field(min_length=1)
    outcome: Literal["YES", "NO"]
    amountAtomic: Atomic

    @field_validator("amountAtomic")
    @classmethod
    def positive_integer(cls, value: str) -> str:
        if not value.isdigit() or int(value) <= 0:
            raise ValueError("amountAtomic must be a positive base-10 integer")
        return value


class PayoutVector(StrictModel):
    worldId: str
    assignments: dict[str, str | bool | int]
    payoutsAtomicByToken: dict[str, Atomic]


class PayoutModel(StrictModel):
    definitionHash: str
    definitionVersion: int = Field(ge=1)
    allowedTokens: dict[str, dict[str, str]]
    validWorlds: list[PayoutVector]
    payoutSemanticsComplete: bool = True
    compatibilityChecksPassed: bool = True
    incompatibilityReasons: list[str] = Field(default_factory=list)


class SolverRequest(StrictModel):
    relationshipDefinitionHash: str
    definitionVersion: int = Field(ge=1)
    legs: list[Leg] = Field(min_length=1)
    payoutModel: PayoutModel


class TerminalWorld(StrictModel):
    worldId: str
    assignments: dict[str, str | bool | int]
    totalPayoutAtomic: Atomic
    payoutsAtomicByLeg: list[Atomic]


class SolverResult(StrictModel):
    isSatisfiable: bool
    guaranteedFloorAtomic: Atomic
    maximumPayoutAtomic: Atomic
    validWorldCount: int
    minimumWorlds: list[TerminalWorld]
    maximumWorlds: list[TerminalWorld]
    allWorlds: list[TerminalWorld] | None = None
    proofArtifactHash: str
    definitionHash: str
    solverVersion: str
    calculationTimestamp: str
    rejectionReasons: list[str]


class ProofArtifact(StrictModel):
    request: SolverRequest
    result: SolverResult
