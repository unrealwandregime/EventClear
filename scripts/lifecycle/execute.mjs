import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  recoverTypedDataAddress,
  decodeEventLog,
} from "viem";
import { canonical } from "../prototype/environment.mjs";
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
export async function executeLifecycle({
  prototype,
  chainId,
  o,
  actors,
  manifest,
  fixture,
  runtime,
  restartHost,
  runUi,
  disposable = false,
}) {
  const aws = prototype ? null : (await import("../aws/common.mjs")).aws;
  const operate = prototype
    ? null
    : (await import("../aws/operate.mjs")).operate;
  const probeRedisFailure = prototype
    ? null
    : (await import("../aws/redis-failure-probe.mjs")).probeRedisFailure;
  const chain = {
    id: chainId,
    name: "Controlled staging test chain",
    nativeCurrency: { name: "Test gas", symbol: "TEST", decimals: 18 },
    rpcUrls: { default: { http: [process.env.STAGING_RPC_PRIMARY] } },
  };
  const client = createPublicClient({
    chain,
    transport: http(process.env.STAGING_RPC_PRIMARY),
  });
  const wallets = Object.fromEntries(
    Object.entries(actors).map(([k, account]) => [
      k,
      createWalletClient({
        account,
        chain,
        transport: http(process.env.STAGING_RPC_PRIMARY),
      }),
    ]),
  );
  let session;
  async function api(path, body) {
    const r = await fetch(`${o.ApiUrl}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-staging-access": runtime.accessToken,
        ...(session ? { authorization: `Bearer ${session}` } : {}),
        "Idempotency-Key": `remote-${crypto.randomUUID()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const code = body.detail?.code ?? body.error?.code;
      throw Error(
        `REMOTE_API_REJECTED:${path}:${r.status}:${/^[A-Z0-9_]{1,100}$/.test(code ?? "") ? code : "UNCLASSIFIED"}`,
      );
    }
    return r.json();
  }
  const abi = (name) =>
    load(`packages/contracts/out/${name}.sol/${name}.json`).abi;
  const names = {
    collateralToken: "MockPUSD",
    conditionalTokens: "MockConditionalTokens",
    resolutionOracle: "MockResolutionOracle",
    fundingPool: "EventClearFundingPool",
    vault: "EventClearVault",
    claims: "EventClearClaims",
    treasury: "EventClearTreasury",
  };
  const address = (key) => manifest.contracts[key].address;
  const read = (key, fn, args = []) =>
    client.readContract({
      address: address(key),
      abi: abi(names[key]),
      functionName: fn,
      args,
    });
  const evidence = {
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    startedAt: new Date().toISOString(),
    environment: prototype ? "testnet-prototype" : "staging",
    region: prototype ? undefined : process.env.AWS_REGION,
    chainId,
    manifestHash: manifest.manifestHash,
    riskSigner: process.env.RISK_SIGNER_ADDRESS,
    transactions: {},
  };
  async function send(actor, key, fn, args, label) {
    const { request } = await client.simulateContract({
      account: actors[actor],
      address: address(key),
      abi: abi(names[key]),
      functionName: fn,
      args,
    });
    const hash = await wallets[actor].writeContract(request);
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 2,
    });
    assert.equal(receipt.status, "success");
    if (label) evidence.transactions[label] = hash;
    return receipt;
  }
  async function prepared(path, body, label) {
    const p = await api(path, body);
    assert.equal(p.chainId, chainId);
    assert.equal(p.transactionRequest.value, "0x0");
    assert.equal(p.transactionRequest.data.slice(0, 10), p.expectedSelector);
    assert.ok(
      ["vault", "conditionalTokens", "fundingPool"].some(
        (k) =>
          address(k).toLowerCase() === p.transactionRequest.to.toLowerCase(),
      ),
    );
    const tx = {
      account: actors.tester,
      to: p.transactionRequest.to,
      data: p.transactionRequest.data,
      value: 0n,
    };
    await client.call(tx);
    const hash = await wallets.tester.sendTransaction(tx);
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 2,
    });
    assert.equal(receipt.status, "success");
    evidence.transactions[label] = hash;
    return receipt;
  }
  async function waitFor(check, label) {
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      const value = await check();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw Error(`REMOTE_ACCEPTANCE_TIMEOUT:${label}`);
  }
  for (const actor of ["lp", "tester", "deployer"])
    assert.ok(
      (await client.getBalance({ address: actors[actor].address })) > 0n,
      `${actor} requires testnet gas`,
    );
  assert.equal((await api("/readiness")).status, "ready");
  const config = await api("/config/public");
  assert.equal(config.chainId, chainId);
  assert.equal(config.mainnetExecution, false);
  assert.equal(config.publicCapitalActivated, false);
  assert.equal(config.executionEnabled, true);
  // This deterministic acceptance uses a fresh contract fixture. Re-running after
  // resolution requires a fresh deployment, never resetting or rewriting chain history.
  const principal = 100000000n,
    deposit = 500000000n;
  assert.equal(
    await read("conditionalTokens", "payoutDenominator", [
      fixture.solverRequest.legs[0].conditionId,
    ]),
    0n,
  );
  assert.ok(
    (await read("collateralToken", "balanceOf", [actors.lp.address])) >=
      deposit,
  );
  const beforeBorrower = await read("collateralToken", "balanceOf", [
    actors.tester.address,
  ]);
  const beforeTreasury = await read("collateralToken", "balanceOf", [
    address("treasury"),
  ]);
  await send(
    "lp",
    "collateralToken",
    "approve",
    [address("fundingPool"), deposit],
    "lpApproval",
  );
  await send(
    "lp",
    "fundingPool",
    "deposit",
    [deposit, actors.lp.address],
    "lpDeposit",
  );
  assert.ok((await read("fundingPool", "balanceOf", [actors.lp.address])) > 0n);
  await runUi("analysis");
  for (const leg of fixture.solverRequest.legs)
    assert.ok(
      (await read("conditionalTokens", "balanceOf", [
        actors.tester.address,
        BigInt(leg.tokenId),
      ])) >= BigInt(leg.amountAtomic),
    );
  const { nonce } = await api("/auth/siwe/nonce", {});
  const message = `${new URL(o.WebUrl).host} wants you to sign in with your Ethereum account:\n${actors.tester.address}\n\nSign in to EventClear.\n\nURI: ${o.WebUrl}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(Date.now() + 600000).toISOString()}`;
  session = (
    await api("/auth/siwe/verify", {
      nonce,
      message,
      signature: await actors.tester.signMessage({ message }),
    })
  ).sessionToken;
  assert.ok(session);
  assert.ok(
    (await api(`/wallets/${actors.tester.address}/eligible-bundles`)).candidates
      .length,
  );
  const payload = {
    accountWallet: actors.tester.address,
    borrower: actors.tester.address,
    positionWallet: actors.tester.address,
    chainId,
    solverRequest: fixture.solverRequest,
  };
  const analysis = await api("/analysis", payload);
  evidence.analysisId = analysis.id;
  evidence.proofHash = analysis.solverResult.artifactHash;
  const artifact = await api(`/analysis/${analysis.id}/artifact`);
  // Feed artifact via stdin: no credentials or session data are written to disk.
  execFileSync(
    "python",
    [
      "-c",
      "import json,sys; from eventclear_solver.models import ProofArtifact; from eventclear_solver.engine import solve; a=ProofArtifact.model_validate(json.load(sys.stdin)); assert solve(a.request,timestamp=a.result.generatedAt)==a.result",
    ],
    { input: JSON.stringify(artifact), stdio: ["pipe", "pipe", "pipe"] },
  );
  assert.equal((await api(`/analysis/${analysis.id}/verify`, {})).valid, true);
  const canonicalDigest =
    "0x" + createHash("sha256").update(canonical(artifact)).digest("hex");
  assert.equal(canonicalDigest, analysis.artifactStorageHash);
  if (prototype) {
    // The API reads back immutable PostgreSQL bytes and checks the content hash.
    assert.equal(analysis.artifactObjectKey, canonicalDigest.slice(2));
    assert.deepEqual(await api(`/analysis/${analysis.id}/artifact`), artifact);
  } else {
    // Verify real bucket controls, versioning and conditional overwrite protection.
    assert.equal(
      aws(["s3api", "get-bucket-versioning", "--bucket", o.ArtifactBucket])
        .Status,
      "Enabled",
    );
    const publicBlock = aws([
      "s3api",
      "get-public-access-block",
      "--bucket",
      o.ArtifactBucket,
    ]).PublicAccessBlockConfiguration;
    assert.ok(Object.values(publicBlock).every(Boolean));
    execFileSync("python", ["scripts/aws/verify-artifact.py"], {
      input: JSON.stringify({
        bucket: o.ArtifactBucket,
        key: analysis.artifactObjectKey,
        sha256: analysis.artifactStorageHash,
      }),
      stdio: ["pipe", "inherit", "pipe"],
    });
  }
  const quote = await api("/quotes", payload);
  evidence.quoteId = quote.id;
  assert.equal(
    (
      await recoverTypedDataAddress({
        ...quote.typedData,
        signature: quote.signature,
      })
    ).toLowerCase(),
    process.env.RISK_SIGNER_ADDRESS.toLowerCase(),
  );
  const walletAuthorizationSignature = await actors.tester.signTypedData(
    quote.walletAuthorization.typedData,
  );
  await prepared(
    "/bundles/open/prepare",
    { quoteId: quote.id, walletAuthorizationSignature },
    "erc1155Approval",
  );
  const receipt = await prepared(
    "/bundles/open/prepare",
    { quoteId: quote.id, walletAuthorizationSignature },
    "bundleOpen",
  );
  let bundleId;
  for (const log of receipt.logs)
    try {
      const event = decodeEventLog({
        abi: abi("EventClearVault"),
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName === "BundleOpened") bundleId = event.args.bundleId;
    } catch {}
  assert.ok(bundleId);
  evidence.bundleId = String(bundleId);
  assert.equal(
    (await read("collateralToken", "balanceOf", [actors.tester.address])) -
      beforeBorrower,
    BigInt(quote.quote.netAdvance),
  );
  for (const leg of fixture.solverRequest.legs)
    assert.equal(
      await read("conditionalTokens", "balanceOf", [
        address("vault"),
        BigInt(leg.tokenId),
      ]),
      BigInt(leg.amountAtomic),
    );
  const principalId = await read("claims", "claimId", [bundleId, 1]),
    residualId = await read("claims", "claimId", [bundleId, 2]);
  assert.equal(
    await read("claims", "balanceOf", [address("fundingPool"), principalId]),
    principal,
  );
  const residualSupply = await read("claims", "balanceOf", [
    actors.tester.address,
    residualId,
  ]);
  assert.ok(residualSupply > 0n);
  const indexed = await waitFor(async () => {
    const rows = (await api("/bundles")).data;
    return rows.find((b) => String(b.onchainBundleId) === String(bundleId));
  }, "indexed bundle");
  const indexedId = indexed.id;
  // Restart API/indexer before settlement to verify persistent analysis, quote and checkpoint.
  const checkpointBefore = await api("/staging/operations");
  if (prototype) {
    evidence.restartDeployment = await restartHost(
      evidence.gitSha,
      async () => {
        await send(
          "tester",
          "claims",
          "safeTransferFrom",
          [actors.tester.address, actors.tester.address, residualId, 1n, "0x"],
          "offlineClaimTransfer",
        );
      },
    );
    await waitFor(async () => {
      try {
        return (await api("/readiness")).status === "ready";
      } catch {
        return false;
      }
    }, "cold start");
  } else {
    for (const svc of ["api", "indexer"])
      aws([
        "ecs",
        "update-service",
        "--cluster",
        o.ClusterArn,
        "--service",
        `${process.env.STAGING_STACK_NAME}-${svc}`,
        "--force-new-deployment",
      ]);
    aws([
      "ecs",
      "wait",
      "services-stable",
      "--cluster",
      o.ClusterArn,
      "--services",
      `${process.env.STAGING_STACK_NAME}-api`,
      `${process.env.STAGING_STACK_NAME}-indexer`,
    ]);
  }
  assert.equal((await api(`/analysis/${analysis.id}`)).id, analysis.id);
  assert.equal((await api(`/quotes/${quote.id}`)).id, quote.id);
  assert.equal(
    (await api("/auth/session")).address.toLowerCase(),
    actors.tester.address.toLowerCase(),
  );
  if (prototype)
    await waitFor(async () => {
      const events = await api("/protocol/events");
      return events.data.some(
        (event) =>
          event.transactionHash?.toLowerCase() ===
            evidence.transactions.offlineClaimTransfer?.toLowerCase() &&
          event.eventName === "TransferSingle",
      );
    }, "offline claim event backfill");
  const checkpointAfter = await api("/staging/operations");
  assert.ok(
    BigInt(checkpointAfter.checkpoint) >= BigInt(checkpointBefore.checkpoint),
  );
  assert.equal(checkpointAfter.duplicateEvents, 0);
  assert.equal(checkpointAfter.deadLetters, 0);
  assert.equal(
    checkpointAfter.migrationLedgerHash,
    checkpointBefore.migrationLedgerHash,
  );
  if (prototype)
    assert.notEqual(checkpointAfter.bootId, checkpointBefore.bootId);
  assert.ok(
    checkpointAfter.redisRestartProbe > checkpointBefore.redisRestartProbe,
  );
  if (prototype)
    evidence.indexerCatchup = {
      status: "passed",
      transactionHash: evidence.transactions.offlineClaimTransfer,
      checkpointBefore: checkpointBefore.checkpoint,
      checkpointAfter: checkpointAfter.checkpoint,
    };
  evidence.restart = {
    api: "passed",
    indexer: "passed",
    before: checkpointBefore,
    after: checkpointAfter,
  };
  evidence.redisUnavailable = prototype
    ? "REMOTE REDIS FAILURE DRILL NOT AVAILABLE; verify isolated CI failure path"
    : await probeRedisFailure(o);
  // Resolve into the middle region: both escrowed legs pay one test pUSD/share.
  for (const [i, leg] of fixture.solverRequest.legs.entries())
    await send(
      "deployer",
      "resolutionOracle",
      "resolve",
      [leg.conditionId, i === 0 ? 1000000n : 0n, i === 0 ? 0n : 1000000n],
      `resolution${i}`,
    );
  await waitFor(async () => {
    const b = await api(`/bundles/${indexedId}`);
    return b.conditionsResolved;
  }, "indexed resolution");
  await prepared(`/bundles/${indexedId}/prepare-settlement`, {}, "settlement");
  await send(
    "lp",
    "fundingPool",
    "redeemPrincipal",
    [address("vault"), bundleId, principal],
    "principalRedemption",
  );
  await waitFor(async () => {
    const c = await api(`/claims/${residualId}`);
    return c.claimType === "RESIDUAL";
  }, "indexed residual");
  await prepared(
    `/claims/${residualId}/prepare-redemption`,
    { amountAtomic: String(residualSupply) },
    "residualRedemption",
  );
  const ledger = {};
  for (const field of [
    "liquidAssets",
    "totalAssets",
    "bookTotalAssets",
    "outstandingAdvanceCostBasis",
    "outstandingQuotedFees",
    "realizedGrossFinancingReturn",
    "realizedLpYield",
    "realizedOriginationFees",
    "realizedProtocolYieldFees",
    "refundedQuotedFees",
    "realizedLoss",
    "cumulativeNetDeposits",
    "cumulativeWithdrawals",
  ])
    ledger[field] = await read("fundingPool", field);
  assert.equal(ledger.outstandingAdvanceCostBasis, 0n);
  assert.equal(ledger.outstandingQuotedFees, 0n);
  assert.equal(ledger.realizedLoss, 0n);
  assert.equal(await read("fundingPool", "realizedReturnIdentityHolds"), true);
  assert.equal(await read("fundingPool", "bookAssetsIdentityHolds"), true);
  assert.equal(ledger.totalAssets, ledger.liquidAssets);
  assert.equal(ledger.bookTotalAssets, ledger.totalAssets);
  assert.equal(
    (await read("collateralToken", "balanceOf", [address("treasury")])) -
      beforeTreasury,
    ledger.realizedOriginationFees + ledger.realizedProtocolYieldFees,
  );
  assert.equal(await read("claims", "totalSupply", [principalId]), 0n);
  assert.equal(await read("claims", "totalSupply", [residualId]), 0n);
  await waitFor(async () => {
    const principalClaim = await api(`/claims/${principalId}`);
    const residualClaim = await api(`/claims/${residualId}`);
    return (
      BigInt(principalClaim.supplyAtomic) === 0n &&
      BigInt(residualClaim.supplyAtomic) === 0n
    );
  }, "indexed final claim burns");
  const indexedPool = await waitFor(async () => {
    const pool = await api("/pool");
    const fields = {
      liquidAtomic: "liquidAssets",
      totalAssetsAtomic: "totalAssets",
      outstandingAdvanceCostBasisAtomic: "outstandingAdvanceCostBasis",
      outstandingQuotedFeesAtomic: "outstandingQuotedFees",
      realizedGrossFinancingReturnAtomic: "realizedGrossFinancingReturn",
      realizedLpYieldAtomic: "realizedLpYield",
      realizedOriginationFeesAtomic: "realizedOriginationFees",
      realizedProtocolYieldFeesAtomic: "realizedProtocolYieldFees",
      realizedLossAtomic: "realizedLoss",
    };
    return Object.entries(fields).every(
      ([field, ledgerField]) =>
        pool[field] !== undefined &&
        BigInt(pool[field]) === ledger[ledgerField],
    )
      ? pool
      : false;
  }, "indexed final pool reconciliation");
  evidence.indexedPool = indexedPool;

  assert.equal(
    await read("collateralToken", "balanceOf", [address("vault")]),
    0n,
  );
  for (const leg of fixture.solverRequest.legs)
    assert.equal(
      await read("conditionalTokens", "balanceOf", [
        address("vault"),
        BigInt(leg.tokenId),
      ]),
      0n,
    );
  const finalBorrower = await read("collateralToken", "balanceOf", [
    actors.tester.address,
  ]);
  assert.equal(
    finalBorrower - beforeBorrower,
    BigInt(quote.quote.netAdvance) + principal + ledger.refundedQuotedFees,
  );
  if (prototype) {
    if (!process.env.PROTOTYPE_PREVIOUS_SHA)
      throw Error("PREVIOUS_IMMUTABLE_SHA_REQUIRED_FOR_ROLLBACK");
    const previous = await restartHost(process.env.PROTOTYPE_PREVIOUS_SHA);
    await waitFor(async () => {
      try {
        return (await api("/readiness")).status === "ready";
      } catch {
        return false;
      }
    }, "rollback health");
    assert.equal((await api(`/analysis/${analysis.id}`)).id, analysis.id);
    const checkpoint = await api("/staging/operations");
    assert.equal(checkpoint.duplicateEvents, 0);
    assert.equal(checkpoint.deadLetters, 0);
    assert.equal(
      checkpoint.migrationLedgerHash,
      checkpointBefore.migrationLedgerHash,
    );
    for (const [field, value] of Object.entries(ledger))
      assert.equal(await read("fundingPool", field), value);
    evidence.rollback = {
      status: disposable ? "DISPOSABLE_RESTART_PATH_ONLY" : "passed",
      previous,
      checkpoint,
    };
    await restartHost(evidence.gitSha);
    await waitFor(async () => {
      try {
        return (await api("/readiness")).status === "ready";
      } catch {
        return false;
      }
    }, "restored release readiness");
  } else {
    await operate("deploy-services");
    await operate("rollback-services");
    assert.equal((await api(`/analysis/${analysis.id}`)).id, analysis.id);
    for (const [field, value] of Object.entries(ledger))
      assert.equal(await read("fundingPool", field), value);
    const rollbackCheckpoint = await api("/staging/operations");
    assert.equal(rollbackCheckpoint.duplicateEvents, 0);
    evidence.rollback = { status: "passed", checkpoint: rollbackCheckpoint };
  }
  evidence.accounting = Object.fromEntries(
    Object.entries(ledger).map(([k, v]) => [k, String(v)]),
  );
  evidence.borrowerBalanceDelta = String(finalBorrower - beforeBorrower);
  evidence.finishedAt = new Date().toISOString();
  if (disposable) {
    evidence.status = "DISPOSABLE_LIFECYCLE_PASSED";
    return evidence;
  }
  const outputPath = prototype
    ? "outputs/prototype/lifecycle.json"
    : "outputs/staging/lifecycle.json";
  mkdirSync(prototype ? "outputs/prototype" : "outputs/staging", {
    recursive: true,
  });
  evidence.status = "BACKEND_LIFECYCLE_PASSED_UI_PENDING";
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n");
  await runUi("final-state");
  evidence.status = "REMOTE_LIFECYCLE_PASSED";
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n");
  writeFileSync(
    prototype
      ? "docs/TESTNET_PROTOTYPE_EVIDENCE.md"
      : "docs/STAGING_LIFECYCLE_EVIDENCE.md",
    `# ${prototype ? "Testnet prototype" : "Staging"} lifecycle evidence\n\nStatus: REMOTE LIFECYCLE PASSED\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`,
  );
  console.log("Remote lifecycle and UI passed; sanitized evidence written.");
  return evidence;
}
