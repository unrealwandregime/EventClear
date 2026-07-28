# Funding-pool accounting

All values are pUSD atomic units. The canonical live fields are
`liquidAssets`, `outstandingAdvanceCostBasis`, `outstandingQuotedFees`,
`bookTotalAssets`, `realizedGrossFinancingReturn`,
`realizedOriginationFees`, `realizedProtocolYieldFees`, `realizedLpYield`,
`realizedLoss`, `refundedQuotedFees`, and `utilizationBps`.

For an outstanding bundle:

```text
gross advance = net borrower transfer + quoted fee liability
book total assets = liquid assets + gross cost basis - quoted fee liability
```

At settlement, `grossYield = max(principalReceived - grossCostBasis, 0)`.
`realizedGrossFinancingReturn = grossYield`. The realized origination fee is
`min(grossYield, quotedFee)` and the remainder
of the quoted fee is refunded. The protocol fee applies only to positive return
above the realized origination fee. Because the quoted fee is excluded from
book assets while outstanding, the pool’s asset appreciation is:

```text
realizedLpYield = grossYield - realizedProtocolYieldFee
realizedGrossFinancingReturn
  = realizedLpYield + realizedProtocolYieldFee
```

The realized origination fee is reported separately because it originates from
the borrower’s initial advance discount and was excluded from book assets as a
liability while pending. Total borrower financing charges are gross financing
return plus the realized origination fee.

The cumulative book identity is checked onchain:

```text
bookTotalAssets + cumulativeWithdrawals + realizedLoss
  = cumulativeNetDeposits + realizedLpYield
```

Direct, unaccounted token donations are outside the pilot ledger and make this
diagnostic return false. Shortfalls realize an explicit loss, pay no treasury
fee, and never draw unrelated LP assets into the vault settlement.
