from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


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


class ThresholdPredicate(StrictModel):
    conditionId: str
    underlyingAsset: str
    quoteCurrency: str
    comparator: Literal["GT", "GTE", "LT", "LTE"]
    thresholdAtomic: Atomic
    observationType: str
    observationTimestamp: str
    priceSource: str
    resolutionSource: str
    cancellationBehavior: str
    fractionalResolutionBehavior: str
    ruleDocumentHash: str

    @field_validator("thresholdAtomic")
    @classmethod
    def integer_threshold(cls, value: str) -> str:
        if not value.lstrip("-").isdigit():
            raise ValueError("thresholdAtomic must be a base-10 integer")
        return value


class PayoutModel(StrictModel):
    definitionHash: str
    definitionVersion: int = Field(ge=1)
    ruleDocumentHash: str
    predicates: list[ThresholdPredicate] = Field(min_length=1)
    allowedTokens: dict[str, dict[str, str]]
    validWorlds: list[PayoutVector]
    exceptionalWorlds: list[PayoutVector] = Field(default_factory=list)
    payoutSemanticsComplete: bool = True
    compatibilityChecksPassed: bool = True
    incompatibilityReasons: list[str] = Field(default_factory=list)


class SolverRequest(StrictModel):
    relationshipDefinitionHash: str
    relationshipVersion: int = Field(
        ge=1,
        validation_alias=AliasChoices("relationshipVersion", "definitionVersion"),
    )
    legs: list[Leg] = Field(min_length=1)
    payoutModel: PayoutModel

    @property
    def definitionVersion(self) -> int:
        return self.relationshipVersion


class TerminalWorld(StrictModel):
    worldId: str
    assignments: dict[str, str | bool | int]
    totalPayoutAtomic: Atomic
    payoutsAtomicByLeg: list[Atomic]


class SolverResult(StrictModel):
    approvedDefinitionFound: bool
    satisfiable: bool
    financingEligible: bool
    guaranteedFloorAtomic: Atomic
    maximumPayoutAtomic: Atomic
    validWorldCount: int
    terminalWorlds: list[TerminalWorld]
    minimumWitnessWorlds: list[TerminalWorld]
    maximumWitnessWorlds: list[TerminalWorld]
    inputHash: str
    definitionHash: str
    artifactHash: str
    solverVersion: str
    generatedAt: str
    rejectionCodes: list[str]
    rejectionExplanations: list[str]

    @property
    def isSatisfiable(self) -> bool:
        return self.satisfiable

    @property
    def minimumWorlds(self) -> list[TerminalWorld]:
        return self.minimumWitnessWorlds

    @property
    def maximumWorlds(self) -> list[TerminalWorld]:
        return self.maximumWitnessWorlds

    @property
    def allWorlds(self) -> list[TerminalWorld]:
        return self.terminalWorlds

    @property
    def proofArtifactHash(self) -> str:
        return self.artifactHash

    @property
    def calculationTimestamp(self) -> str:
        return self.generatedAt

    @property
    def rejectionReasons(self) -> list[str]:
        return self.rejectionCodes


class ProofArtifact(StrictModel):
    request: SolverRequest
    result: SolverResult
