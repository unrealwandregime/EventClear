# Slither finding review

This is an internal engineering review for test assets, not an independent audit.

Command: `slither . --config-file ../../slither.config.json --json report.json` from `packages/contracts`.

Initial scan: 40 findings, zero high/critical. Explicit local initialization, constructor parameter shadowing and escrow zero-beneficiary validation were fixed. The unchanged high-severity gate remains enabled. No detector was suppressed.

Rescan: 32 remaining findings. Each is recorded below with an explicit disposition. No finding authorizes a capital-bearing release.

## 1. incorrect-equality — Medium

```text
EventClearFundingPool.realizedReturnIdentityHolds() (src/EventClearFundingPool.sol#203-205) uses a dangerous strict equality:
	- realizedGrossFinancingReturn == realizedLpYield + realizedProtocolYieldFees (src/EventClearFundingPool.sol#204)
```

Accepted for the test-only prototype. The identity helpers intentionally compare integer accounting totals for equality; changing to inequalities would conceal drift. Zero-assets branches enforce empty-pool behavior and division-by-zero safety. They do not depend on exact externally manipulated token balances for authorization. Donations can affect reported utilization/valuation, so production economics still require external review.

## 2. incorrect-equality — Medium

```text
EventClearFundingPool.bookAssetsIdentityHolds() (src/EventClearFundingPool.sol#207-209) uses a dangerous strict equality:
	- bookTotalAssets() + cumulativeWithdrawals + realizedLoss == cumulativeNetDeposits + realizedLpYield (src/EventClearFundingPool.sol#208)
```

Accepted for the test-only prototype. The identity helpers intentionally compare integer accounting totals for equality; changing to inequalities would conceal drift. Zero-assets branches enforce empty-pool behavior and division-by-zero safety. They do not depend on exact externally manipulated token balances for authorization. Donations can affect reported utilization/valuation, so production economics still require external review.

## 3. incorrect-equality — Medium

```text
EventClearFundingPool.utilizationBps() (src/EventClearFundingPool.sol#217-220) uses a dangerous strict equality:
	- assets == 0 (src/EventClearFundingPool.sol#219)
```

Accepted for the test-only prototype. The identity helpers intentionally compare integer accounting totals for equality; changing to inequalities would conceal drift. Zero-assets branches enforce empty-pool behavior and division-by-zero safety. They do not depend on exact externally manipulated token balances for authorization. Donations can affect reported utilization/valuation, so production economics still require external review.

## 4. incorrect-equality — Medium

```text
EventClearFundingPool.fundAdvance(uint256,address,uint256,uint256) (src/EventClearFundingPool.sol#114-137) uses a dangerous strict equality:
	- assets == 0 || (outstandingAdvanceCostBasis + amount) * 10_000 > assets * utilizationCapBps (src/EventClearFundingPool.sol#122)
```

Accepted for the test-only prototype. The identity helpers intentionally compare integer accounting totals for equality; changing to inequalities would conceal drift. Zero-assets branches enforce empty-pool behavior and division-by-zero safety. They do not depend on exact externally manipulated token balances for authorization. Donations can affect reported utilization/valuation, so production economics still require external review.

## 5. reentrancy-no-eth — Medium

```text
Reentrancy in EventClearVault.settle(uint256) (src/EventClearVault.sol#378-404):
	External calls:
	- positions.setApprovalForAll(address(adapter),true) (src/EventClearVault.sol#386)
	- adapter.redeem(conditionIds,_tokenIds[bundleId],_amounts[bundleId]) (src/EventClearVault.sol#387)
	- positions.setApprovalForAll(address(adapter),false) (src/EventClearVault.sol#388)
	State variables written after the call(s):
	- bundle.settlementProceeds = proceeds (src/EventClearVault.sol#390)
	EventClearVault.bundles (src/EventClearVault.sol#108) can be used in cross function reentrancies:
	- EventClearVault.bundles (src/EventClearVault.sol#108)
	- EventClearVault.getBundle(uint256) (src/EventClearVault.sol#460-462)
	- bundle.principalAllocation = proceeds (src/EventClearVault.sol#391)
	EventClearVault.bundles (src/EventClearVault.sol#108) can be used in cross function reentrancies:
	- EventClearVault.bundles (src/EventClearVault.sol#108)
	- EventClearVault.getBundle(uint256) (src/EventClearVault.sol#460-462)
	- bundle.principalAllocation = bundle.principalAmount (src/EventClearVault.sol#391)
	EventClearVault.bundles (src/EventClearVault.sol#108) can be used in cross function reentrancies:
	- EventClearVault.bundles (src/EventClearVault.sol#108)
	- EventClearVault.getBundle(uint256) (src/EventClearVault.sol#460-462)
	- bundle.residualAllocation = proceeds - bundle.principalAmount (src/EventClearVault.sol#392)
	EventClearVault.bundles (src/EventClearVault.sol#108) can be used in cross function reentrancies:
	- EventClearVault.bundles (src/EventClearVault.sol#108)
	- EventClearVault.getBundle(uint256) (src/EventClearVault.sol#460-462)
	- bundle.residualAllocation = 0 (src/EventClearVault.sol#392)
	EventClearVault.bundles (src/EventClearVault.sol#108) can be used in cross function reentrancies:
	- EventClearVault.bundles (src/EventClearVault.sol#108)
	- EventClearVault.getBundle(uint256) (src/EventClearVault.sol#460-462)
```

Accepted only with the existing nonReentrant guard and reviewed immutable adapter/token dependencies. settle marks RESOLUTION_PENDING before adapter calls; all capital-changing vault entrypoints are guarded. Callback reads can observe the pending state; integrations must not treat pending as settled. Allocation writes follow redemption because actual balance delta is required. This is not independent audit clearance.

## 6. calls-loop — Low

```text
PolymarketStandardAdapter.positionIds(bytes32) (src/PolymarketStandardAdapter.sol#149-154) has external calls inside a loop: noCollection = conditionalTokens.getCollectionId(bytes32(0),conditionId,2) (src/PolymarketStandardAdapter.sol#151)
	Calls stack containing the loop:
		PolymarketStandardAdapter.redeem(bytes32[],uint256[],uint256[])
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 7. calls-loop — Low

```text
PolymarketStandardAdapter.anyResolved(bytes32[]) (src/PolymarketStandardAdapter.sol#121-126) has external calls inside a loop: conditionalTokens.payoutDenominator(conditionIds[i]) != 0 (src/PolymarketStandardAdapter.sol#123)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 8. calls-loop — Low

```text
MockCTFAdapter.anyResolved(bytes32[]) (src/mocks/MockCTFAdapter.sol#25-30) has external calls inside a loop: positions.payoutYes(conditionIds[i]) + positions.payoutNo(conditionIds[i]) == 1_000_000 (src/mocks/MockCTFAdapter.sol#27)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 9. calls-loop — Low

```text
PolymarketStandardAdapter.positionIds(bytes32) (src/PolymarketStandardAdapter.sol#149-154) has external calls inside a loop: yesCollection = conditionalTokens.getCollectionId(bytes32(0),conditionId,1) (src/PolymarketStandardAdapter.sol#150)
	Calls stack containing the loop:
		PolymarketStandardAdapter.redeem(bytes32[],uint256[],uint256[])
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 10. calls-loop — Low

```text
ExactRedemptionEscrow.redeem(bytes32[]) (src/PolymarketStandardAdapter.sol#67-78) has external calls inside a loop: officialAdapter.redeemPositions(address(pUSD),bytes32(0),conditionIds[i],indexSets) (src/PolymarketStandardAdapter.sol#74)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 11. calls-loop — Low

```text
MockCTFAdapter.areResolved(bytes32[]) (src/mocks/MockCTFAdapter.sol#18-23) has external calls inside a loop: positions.payoutYes(conditionIds[i]) + positions.payoutNo(conditionIds[i]) != 1_000_000 (src/mocks/MockCTFAdapter.sol#20)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 12. calls-loop — Low

```text
MockCTFAdapter.redeem(bytes32[],uint256[],uint256[]) (src/mocks/MockCTFAdapter.sol#32-39) has external calls inside a loop: payout += positions.burnForRedemption(address(this),tokenIds[i],amounts[i]) (src/mocks/MockCTFAdapter.sol#36)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 13. calls-loop — Low

```text
PolymarketStandardAdapter.redeem(bytes32[],uint256[],uint256[]) (src/PolymarketStandardAdapter.sol#128-147) has external calls inside a loop: conditionalTokens.balanceOf(address(escrow),tokenIds[i_scope_0]) != 0 (src/PolymarketStandardAdapter.sol#145)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 14. calls-loop — Low

```text
PolymarketStandardAdapter.areResolved(bytes32[]) (src/PolymarketStandardAdapter.sol#113-119) has external calls inside a loop: conditionalTokens.payoutDenominator(conditionIds[i]) == 0 (src/PolymarketStandardAdapter.sol#116)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 15. calls-loop — Low

```text
MockCTFAdapter.redeem(bytes32[],uint256[],uint256[]) (src/mocks/MockCTFAdapter.sol#32-39) has external calls inside a loop: positions.safeTransferFrom(msg.sender,address(this),tokenIds[i],amounts[i],) (src/mocks/MockCTFAdapter.sol#35)
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 16. calls-loop — Low

```text
PolymarketStandardAdapter.positionIds(bytes32) (src/PolymarketStandardAdapter.sol#149-154) has external calls inside a loop: noTokenId = conditionalTokens.getPositionId(usdce,noCollection) (src/PolymarketStandardAdapter.sol#153)
	Calls stack containing the loop:
		PolymarketStandardAdapter.redeem(bytes32[],uint256[],uint256[])
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 17. calls-loop — Low

```text
PolymarketStandardAdapter.positionIds(bytes32) (src/PolymarketStandardAdapter.sol#149-154) has external calls inside a loop: yesTokenId = conditionalTokens.getPositionId(usdce,yesCollection) (src/PolymarketStandardAdapter.sol#152)
	Calls stack containing the loop:
		PolymarketStandardAdapter.redeem(bytes32[],uint256[],uint256[])
```

Accepted for test assets. These calls read/redeem each reviewed position/condition; omitting them would leave collateral unverified or unredeemed. The signed quote and reviewed relationship bound the accepted bundle inputs. Large caller-supplied arrays can exhaust the caller transaction gas; no global batch/cursor is advanced on failure. Arbitrary untrusted adapters are not enabled. Production gas bounds require review.

## 18. reentrancy-benign — Low

```text
Reentrancy in EventClearVault.openBundle(EventClearVault.FinancingQuote,bytes,bytes,bytes32[],uint256[],uint8[],uint256[],uint32) (src/EventClearVault.sol#246-376):
	External calls:
	- riskPolicy.validateAndConsume(quote.positionWallet,quote.relationshipDefinitionHash,conditionIds,riskPolicy.CRYPTO_THRESHOLD_V1(),address(adapter),address(collateral),quote.guaranteedFloor,quote.grossAdvance,quote.expiry,quote.latestResolutionTimestamp) (src/EventClearVault.sol#335-346)
	State variables written after the call(s):
	- _amounts[bundleId] = amounts (src/EventClearVault.sol#366)
	- _conditionIds[bundleId] = conditionIds (src/EventClearVault.sol#364)
	- _tokenIds[bundleId] = tokenIds (src/EventClearVault.sol#365)
	- bundles[bundleId] = Bundle({borrower:quote.borrower,positionWallet:quote.positionWallet,relationshipDefinitionHash:quote.relationshipDefinitionHash,solverArtifactHash:quote.solverArtifactHash,principalAmount:quote.principalAmount,grossAdvance:quote.grossAdvance,netAdvance:quote.netAdvance,settlementProceeds:0,principalAllocation:0,residualAllocation:0,principalClaimed:0,residualClaimed:0,status:BundleStatus.ACTIVE}) (src/EventClearVault.sol#349-363)
	- bundleId = nextBundleId ++ (src/EventClearVault.sol#348)
```

Accepted with openBundle nonReentrant, fixed RiskPolicy dependency and role-restricted validation. A callback cannot originate a second bundle. Effects and all token transfers are atomic on revert; a view during execution is not a settled read model.

## 19. reentrancy-events — Low

```text
Reentrancy in EventClearFundingPool._recordSettlement(uint256,uint256) (src/EventClearFundingPool.sol#151-186):
	External calls:
	- IFeeTreasury(feeTreasury).recordFee(keccak256(bytes)(ORIGINATION),realizedOriginationFee) (src/EventClearFundingPool.sol#177)
	- IFeeTreasury(feeTreasury).recordFee(keccak256(bytes)(REALIZED_FINANCING_RETURN),protocolFee) (src/EventClearFundingPool.sol#181)
	Event emitted after the call(s):
	- OriginationFeeSettled(bundleId,quotedFee,realizedOriginationFee,refundedFee) (src/EventClearFundingPool.sol#184)
	- PrincipalSettled(bundleId,principalReceived,grossFinancingReturn,lpYield,protocolFee) (src/EventClearFundingPool.sol#185)
```

Accepted for this controlled prototype. The known treasury records fees and emits its own events; ledger effects are set before treasury callbacks. Indexing is by transaction/log identity, not assumed cross-contract event order. redeemPrincipal remains permissionless; test-only fixed assets/vault wiring and accounting assertions are required. Generic malicious-token/treasury behavior is outside the supported configuration and needs production audit.

## 20. reentrancy-events — Low

```text
Reentrancy in EventClearFundingPool.redeemPrincipal(IPrincipalVault,uint256,uint256) (src/EventClearFundingPool.sol#145-149):
	External calls:
	- vault.redeemPrincipal(bundleId,claimAmount) (src/EventClearFundingPool.sol#147)
	- _recordSettlement(bundleId,IERC20(asset()).balanceOf(address(this)) - beforeBalance) (src/EventClearFundingPool.sol#148)
		- IFeeTreasury(feeTreasury).recordFee(keccak256(bytes)(ORIGINATION),realizedOriginationFee) (src/EventClearFundingPool.sol#177)
		- IFeeTreasury(feeTreasury).recordFee(keccak256(bytes)(REALIZED_FINANCING_RETURN),protocolFee) (src/EventClearFundingPool.sol#181)
	Event emitted after the call(s):
	- OriginationFeeSettled(bundleId,quotedFee,realizedOriginationFee,refundedFee) (src/EventClearFundingPool.sol#184)
		- _recordSettlement(bundleId,IERC20(asset()).balanceOf(address(this)) - beforeBalance) (src/EventClearFundingPool.sol#148)
	- PrincipalSettled(bundleId,principalReceived,grossFinancingReturn,lpYield,protocolFee) (src/EventClearFundingPool.sol#185)
		- _recordSettlement(bundleId,IERC20(asset()).balanceOf(address(this)) - beforeBalance) (src/EventClearFundingPool.sol#148)
```

Accepted for this controlled prototype. The known treasury records fees and emits its own events; ledger effects are set before treasury callbacks. Indexing is by transaction/log identity, not assumed cross-contract event order. redeemPrincipal remains permissionless; test-only fixed assets/vault wiring and accounting assertions are required. Generic malicious-token/treasury behavior is outside the supported configuration and needs production audit.

## 21. timestamp — Low

```text
RiskPolicy.validateAndConsume(address,bytes32,bytes32[],bytes32,address,address,uint256,uint256,uint256,uint256) (src/RiskPolicy.sol#71-116) uses timestamp for comparisons
	Dangerous comparisons:
	- wallet == address(0) || relationshipHash == bytes32(0) || marketIds.length == 0 || guaranteedFloor == 0 || grossAdvance == 0 || expiry < block.timestamp || latestResolutionTimestamp <= block.timestamp (src/RiskPolicy.sol#85-86)
	- grossAdvance > maximumGrossAdvance || grossAdvance * 10_000 > guaranteedFloor * maximumAdvanceRatioBps || latestResolutionTimestamp - block.timestamp > maximumBundleDuration || walletExposure[wallet] + grossAdvance > perWalletExposureCap || relationshipExposure[relationshipHash] + grossAdvance > perRelationshipExposureCap || globalExposure + grossAdvance > globalExposureCap (src/RiskPolicy.sol#93-97)
```

Accepted: timestamps intentionally enforce quote/authorization expiry, duration limits and reviewed relationship validity. They are not randomness or a price oracle. Boundary inclusion is explicit; small validator timestamp shifts can shorten usability, so clients use short expiry and verify before submission.

## 22. timestamp — Low

```text
EventClearVault.openBundle(EventClearVault.FinancingQuote,bytes,bytes,bytes32[],uint256[],uint8[],uint256[],uint32) (src/EventClearVault.sol#246-376) uses timestamp for comparisons
	Dangerous comparisons:
	- quote.expiry < block.timestamp (src/EventClearVault.sol#262)
	- authorization.expiry < block.timestamp (src/EventClearVault.sol#267)
```

Accepted: timestamps intentionally enforce quote/authorization expiry, duration limits and reviewed relationship validity. They are not randomness or a price oracle. Boundary inclusion is explicit; small validator timestamp shifts can shorten usability, so clients use short expiry and verify before submission.

## 23. timestamp — Low

```text
RelationshipRegistry.isActive(bytes32) (src/RelationshipRegistry.sol#83-87) uses timestamp for comparisons
	Dangerous comparisons:
	- item.status == Status.APPROVED && block.timestamp >= item.validFrom && (item.validUntil == 0 || block.timestamp <= item.validUntil) (src/RelationshipRegistry.sol#85-86)
```

Accepted: timestamps intentionally enforce quote/authorization expiry, duration limits and reviewed relationship validity. They are not randomness or a price oracle. Boundary inclusion is explicit; small validator timestamp shifts can shorten usability, so clients use short expiry and verify before submission.

## 24. cyclomatic-complexity — Informational

```text
EventClearVault.openBundle(EventClearVault.FinancingQuote,bytes,bytes,bytes32[],uint256[],uint8[],uint256[],uint32) (src/EventClearVault.sol#246-376) has a high cyclomatic complexity (17).
```

Accepted for this sprint. openBundle combines identity, relationship, quote, escrow and accounting checks; deleting branches would weaken validation. ABI, fuzz/invariant, solver and integration tests cover the path. A later audit may recommend splitting validation without changing behavior.

## 25. missing-inheritance — Informational

```text
MockConditionalTokens (src/mocks/MockConditionalTokens.sol#8-78) should inherit from IPolymarketConditionalTokens (src/PolymarketStandardAdapter.sol#10-23)
```

Accepted: Solidity structural ABI compatibility is deliberate across mock/protocol interfaces. Existing ABI checks and actual deployed-contract integration verify calls. Adding cross-file inheritance purely for the detector is unnecessary coupling; mocks remain test-only.

## 26. missing-inheritance — Informational

```text
EventClearTreasury (src/EventClearTreasury.sol#8-32) should inherit from IFeeTreasury (src/EventClearFundingPool.sol#15-17)
```

Accepted: Solidity structural ABI compatibility is deliberate across mock/protocol interfaces. Existing ABI checks and actual deployed-contract integration verify calls. Adding cross-file inheritance purely for the detector is unnecessary coupling; mocks remain test-only.

## 27. missing-inheritance — Informational

```text
MockCTFAdapter (src/mocks/MockCTFAdapter.sol#9-40) should inherit from IRedemptionAdapter (src/EventClearVault.sol#19-23)
```

Accepted: Solidity structural ABI compatibility is deliberate across mock/protocol interfaces. Existing ABI checks and actual deployed-contract integration verify calls. Adding cross-file inheritance purely for the detector is unnecessary coupling; mocks remain test-only.

## 28. missing-inheritance — Informational

```text
EventClearVault (src/EventClearVault.sol#26-471) should inherit from IPrincipalVault (src/EventClearFundingPool.sol#11-13)
```

Accepted: Solidity structural ABI compatibility is deliberate across mock/protocol interfaces. Existing ABI checks and actual deployed-contract integration verify calls. Adding cross-file inheritance purely for the detector is unnecessary coupling; mocks remain test-only.

## 29. missing-inheritance — Informational

```text
MockOfficialCTFAdapter (src/mocks/MockOfficialCTFAdapter.sol#9-40) should inherit from IPolymarketOfficialCTFAdapter (src/PolymarketStandardAdapter.sol#30-37)
```

Accepted: Solidity structural ABI compatibility is deliberate across mock/protocol interfaces. Existing ABI checks and actual deployed-contract integration verify calls. Adding cross-file inheritance purely for the detector is unnecessary coupling; mocks remain test-only.

## 30. missing-inheritance — Informational

```text
MockPUSD (src/mocks/MockPUSD.sol#7-22) should inherit from IPolymarketCollateralToken (src/PolymarketStandardAdapter.sol#26-28)
```

Accepted: Solidity structural ABI compatibility is deliberate across mock/protocol interfaces. Existing ABI checks and actual deployed-contract integration verify calls. Adding cross-file inheritance purely for the detector is unnecessary coupling; mocks remain test-only.

## 31. immutable-states — Optimization

```text
EventClearFundingPool.perBundleCap (src/EventClearFundingPool.sol#36) should be immutable
```

Accepted optimization suggestion. Existing storage layout/cap semantics are retained; these values are constructor-initialized and no setter is currently exposed. Making them immutable is not required for correctness and would change deployed bytecode for a gas-only optimization.

## 32. immutable-states — Optimization

```text
EventClearFundingPool.depositCap (src/EventClearFundingPool.sol#35) should be immutable
```

Accepted optimization suggestion. Existing storage layout/cap semantics are retained; these values are constructor-initialized and no setter is currently exposed. Making them immutable is not required for correctness and would change deployed bytecode for a gas-only optimization.
