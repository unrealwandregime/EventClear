import { expect, test, type Page, type Route } from "@playwright/test";

const account = "0x0000000000000000000000000000000000000001";
const vault = "0x0000000000000000000000000000000000001000";
const pool = "0x0000000000000000000000000000000000002000";
const pusd = "0x0000000000000000000000000000000000003000";
const ctf = "0x0000000000000000000000000000000000004000";
const definitionHash = `0x${"11".repeat(32)}`;
const artifactHash = `0x${"22".repeat(32)}`;
const conditionOne = `0x${"33".repeat(32)}`;
const conditionTwo = `0x${"44".repeat(32)}`;
const approvalHash = `0x${"aa".repeat(32)}`;
const bundleHash = `0x${"bb".repeat(32)}`;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installWallet(
  page: Page,
  options: { rejectSignature?: boolean; wrongChain?: boolean; revertBundle?: boolean } = {},
) {
  await page.addInitScript(({ wallet, approvalTx, openTx, controls }) => {
    let sends = 0;
    Object.defineProperty(window, "ethereum", {
      value: {
        async request({ method }: { method: string }) {
          if (method === "eth_requestAccounts") return [wallet];
          if (method === "eth_chainId") return controls.wrongChain ? "0x1" : "0x7a69";
          if (method === "wallet_switchEthereumChain") {
            if (controls.wrongChain) throw new Error("WRONG_CHAIN");
            return null;
          }
          if (method === "personal_sign") {
            if (controls.rejectSignature) throw new Error("USER_REJECTED_SIGNATURE");
            return `0x${"99".repeat(65)}`;
          }
          if (method === "eth_signTypedData_v4") return `0x${"88".repeat(65)}`;
          if (method === "eth_call") return `0x${"0".repeat(63)}1`;
          if (method === "eth_sendTransaction") {
            sends += 1;
            return sends === 1 ? approvalTx : openTx;
          }
          if (method === "eth_getTransactionReceipt") {
            return {
              status: controls.revertBundle && sends > 1 ? "0x0" : "0x1",
            };
          }
          throw new Error(`UNHANDLED_WALLET_METHOD:${method}`);
        },
      },
    });
  }, {
    wallet: account,
    approvalTx: approvalHash,
    openTx: bundleHash,
    controls: options,
  });
}

async function mockApi(
  page: Page,
  options: { quoteFailure?: string; expiredQuote?: boolean; delayedIndexer?: boolean } = {},
) {
  let prepareCalls = 0;
  let eventCalls = 0;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (path === "/config/public") return json(route, {
      chainId: 31337,
      mainnetExecution: true,
      environment: "local",
      dataSource: "seeded-local",
      executionStatus: "controlled execution",
      contractDeploymentStatus: "local deployed",
      indexerStatus: "healthy",
      relationshipDatabaseStatus: "reviewed local",
      vaultAddress: vault,
      fundingPoolAddress: pool,
      collateralTokenAddress: pusd,
      conditionalTokensAddress: ctf,
    });
    if (path === "/protocol/metrics") return json(route, {
      available: true,
      activeBundles: 0,
      guaranteedFloorEscrowedAtomic: "0",
      netAdvancesAtomic: "0",
      approvedRelationships: 1,
    });
    if (path === "/relationships") return json(route, { data: [{
      id: "BTC-LADDER",
      relationshipType: "CRYPTO_THRESHOLD_V1",
      version: 1,
      status: "APPROVED",
      resolutionRulesHash: artifactHash,
      canonicalDefinitionHash: definitionHash,
      earliestResolutionTimestamp: 1_800_000_000,
      latestResolutionTimestamp: 1_810_000_000,
      reviewedMarkets: [
        { conditionId: conditionOne, tokenIds: { YES: "1", NO: "2" } },
        { conditionId: conditionTwo, tokenIds: { YES: "3", NO: "4" } },
      ],
    }] });
    if (path === "/bundles") return json(route, { data: [] });
    if (path === "/claims") return json(route, { data: [] });
    if (path === "/pool") return json(route, {
      totalAssetsAtomic: "1000000000",
      liquidAtomic: "1000000000",
      outstandingAdvanceCostBasisAtomic: "0",
      outstandingQuotedFeesAtomic: "0",
      realizedGrossFinancingReturnAtomic: "0",
      realizedLpYieldAtomic: "0",
      realizedOriginationFeesAtomic: "0",
      realizedProtocolYieldFeesAtomic: "0",
      refundedQuotedFeesAtomic: "0",
      realizedLossAtomic: "0",
      utilizationBps: 0,
    });
    if (path === "/auth/siwe/nonce") return json(route, { nonce: "local-nonce" });
    if (path === "/auth/siwe/verify") return json(route, {
      sessionToken: "test-session",
      address: account,
    });
    if (path === "/auth/session") return json(route, { address: account });
    if (path === `/wallets/${account}`) return json(route, {
      signerAddress: account,
      positionWallet: account,
      walletType: "EOA",
      executionSupported: true,
    });
    if (path === `/wallets/${account}/positions`) return json(route, { positions: [
      { conditionId: conditionOne, tokenId: "1", outcome: "YES", amountAtomic: "100000000", currentValueAtomic: "60000000", title: "BTC ≤ 100K" },
      { conditionId: conditionTwo, tokenId: "4", outcome: "NO", amountAtomic: "100000000", currentValueAtomic: "55000000", title: "BTC > 150K" },
    ] });
    if (path === `/pool/account/${account}`) return json(route, {
      sharesAtomic: "10000000",
      availableWithdrawalAtomic: "5000000",
      allowlisted: true,
    });
    if (path === "/analysis") return json(route, {
      id: "analysis-1",
      solverResult: {
        financingEligible: true,
        guaranteedFloorAtomic: "100000000",
        maximumPayoutAtomic: "200000000",
        terminalWorlds: [
          { worldId: "below", assignments: {}, totalPayoutAtomic: "100000000", payoutsAtomicByLeg: ["100000000", "0"] },
          { worldId: "middle", assignments: {}, totalPayoutAtomic: "200000000", payoutsAtomicByLeg: ["100000000", "100000000"] },
        ],
        minimumWitnessWorlds: [{ worldId: "below" }],
        maximumWitnessWorlds: [{ worldId: "middle" }],
        solverVersion: "2.0.0",
        definitionHash,
        artifactHash,
      },
      artifact: {
        request: {
          relationshipDefinitionHash: definitionHash,
          relationshipVersion: 1,
          legs: [
            { conditionId: conditionOne, tokenId: "1", outcome: "YES", amountAtomic: "100000000" },
            { conditionId: conditionTwo, tokenId: "4", outcome: "NO", amountAtomic: "100000000" },
          ],
        },
      },
      relationship: {
        id: "BTC-LADDER",
        version: 1,
        ruleDocumentHash: artifactHash,
        earliestResolutionTimestamp: 1_800_000_000,
        latestResolutionTimestamp: 1_810_000_000,
      },
    });
    if (path === "/analysis/analysis-1/verify") return json(route, { valid: true });
    if (path === "/quotes") {
      if (options.quoteFailure) {
        return json(route, { detail: { code: options.quoteFailure } }, 422);
      }
      return json(route, {
        id: "quote-1",
        quote: {
          borrower: account,
          positionWallet: account,
          grossAdvance: "95000000",
          originationFee: "475000",
          netAdvance: "94525000",
          principalAmount: "100000000",
          expiry: String(options.expiredQuote
            ? Math.floor(Date.now() / 1000) - 1
            : Math.floor(Date.now() / 1000) + 300),
          vault,
          fundingPool: pool,
          chainId: "31337",
        },
        signature: `0x${"77".repeat(65)}`,
        riskSigner: account,
        solverResult: {},
        typedData: {},
        walletAuthorization: { authorization: {}, typedData: {} },
      });
    }
    if (path === "/bundles/open/prepare") {
      prepareCalls += 1;
      const approval = prepareCalls === 1;
      const target = approval ? ctf : vault;
      const data = approval ? "0xa22cb46500" : "0x1234567800";
      return json(route, {
        action: approval ? "APPROVE_POSITIONS" : "OPEN_BUNDLE",
        chainId: 31337,
        expectedSelector: data.slice(0, 10),
        transactionRequest: { to: target, data, value: "0x0" },
        simulation: { status: "success", gasEstimate: "500000" },
        correlationId: "e2e",
      });
    }
    if (path === "/protocol/events") {
      eventCalls += 1;
      const visible = !options.delayedIndexer || eventCalls > 1;
      return json(route, { data: visible ? [
        { transactionHash: bundleHash, eventName: "PositionsEscrowed" },
        { transactionHash: bundleHash, eventName: "AdvanceFunded" },
        { transactionHash: bundleHash, eventName: "ClaimsMinted" },
      ] : [] });
    }
    return json(route, { detail: { code: `UNMOCKED:${path}` } }, 404);
  });
}

async function connectAndAnalyze(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() =>
    document.documentElement.dataset.eventclearHydrated === "true"
  );
  const connect = page.getByRole("button", { name: "Connect wallet + SIWE" });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.getByRole("status")).toContainText("Wallet authenticated");
  await page.getByRole("button", { name: "Scanner" }).click();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Submit exact bundle for analysis" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function acceptExecutionConfirmations(page: Page) {
  const dialog = page.getByRole("dialog");
  const confirmations = [
    "I reviewed the market resolution rules.",
    "I understand the relationship model may be incorrect despite solver verification.",
    "I authorize the exact listed positions to be escrowed.",
    "I understand EventClear is unaudited.",
  ];
  for (const label of confirmations) {
    const checkbox = dialog.getByRole("checkbox", { name: label });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  }
  await expect(
    dialog.getByRole("button", { name: "Sign exact wallet authorization and continue" }),
  ).toBeEnabled();
}

test("complete wallet, analysis, proof, quote and indexed opening lifecycle survives refresh", async ({ page }) => {
  await installWallet(page);
  await mockApi(page, { delayedIndexer: true });
  await connectAndAnalyze(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download proof artifact" }).click();
  expect((await download).suggestedFilename()).toContain("eventclear-proof");
  await page.getByRole("button", { name: "Verify proof artifact" }).click();
  await expect(page.getByRole("status")).toContainText("reproduced successfully");
  await page.getByRole("button", { name: "Request live quote" }).click();
  await acceptExecutionConfirmations(page);
  await page.getByRole("button", { name: "Sign exact wallet authorization and continue" }).click();
  await expect(page.getByText("indexer confirmed")).toBeVisible();
  await page.reload();
  await page.waitForFunction(() =>
    document.documentElement.dataset.eventclearHydrated === "true"
  );
  await expect(page.getByRole("button", { name: /0x0000/ })).toBeVisible();
  await page.getByRole("button", { name: "Bundles" }).click();
  await expect(page.getByText("indexer confirmed")).toBeVisible();
});

test("wallet signature rejection is explicit", async ({ page }) => {
  await installWallet(page, { rejectSignature: true });
  await mockApi(page);
  await page.goto("/");
  await page.waitForFunction(() =>
    document.documentElement.dataset.eventclearHydrated === "true"
  );
  const connect = page.getByRole("button", { name: "Connect wallet + SIWE" });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.getByRole("status")).toContainText("USER_REJECTED_SIGNATURE");
});

test("wrong-chain failure is explicit", async ({ page }) => {
  await installWallet(page, { wrongChain: true });
  await mockApi(page);
  await page.goto("/");
  await page.waitForFunction(() =>
    document.documentElement.dataset.eventclearHydrated === "true"
  );
  const connect = page.getByRole("button", { name: "Connect wallet + SIWE" });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.getByRole("status")).toContainText("WRONG_CHAIN");
});

for (const code of ["POSITION_BALANCE_INSUFFICIENT", "POOL_LIQUIDITY_INSUFFICIENT"]) {
  test(`quote preflight surfaces ${code}`, async ({ page }) => {
    await installWallet(page);
    await mockApi(page, { quoteFailure: code });
    await connectAndAnalyze(page);
    await page.getByRole("button", { name: "Request live quote" }).click();
    await expect(page.getByRole("status")).toContainText(code);
  });
}

test("expired quote cannot be submitted", async ({ page }) => {
  await installWallet(page);
  await mockApi(page, { expiredQuote: true });
  await connectAndAnalyze(page);
  await page.getByRole("button", { name: "Request live quote" }).click();
  await expect(page.getByRole("button", {
    name: "Sign exact wallet authorization and continue",
  })).toBeDisabled();
});

test("reverted bundle transaction is surfaced and persisted", async ({ page }) => {
  await installWallet(page, { revertBundle: true });
  await mockApi(page);
  await connectAndAnalyze(page);
  await page.getByRole("button", { name: "Request live quote" }).click();
  await acceptExecutionConfirmations(page);
  await page.getByRole("button", { name: "Sign exact wallet authorization and continue" }).click();
  await expect(page.getByText("lifecycle failed")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("TRANSACTION_REVERTED");
});
