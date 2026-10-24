// Integration harness only. No external entrypoint accepts these local transports.
// Application mode guards remain active; the disposable chain advertises Sepolia's
// ID solely inside this test. This produces no remote-testnet acceptance evidence.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as httpsServer } from "node:https";
import { request as plainRequest } from "node:http";
import { createServer as tlsServer } from "node:tls";
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonical } from "../../scripts/prototype/environment.mjs";
import {
  limits,
  verifyDeployment,
} from "../../scripts/aws/deploy-contracts.mjs";
import { executeLifecycle } from "../../scripts/lifecycle/execute.mjs";

const directory = process.env.PROTOTYPE_TEST_TLS_DIR;
if (!directory || !process.env.PROTOTYPE_TEST_DATABASE_URL)
  throw Error("DISPOSABLE_TEST_INFRA_REQUIRED");
const image = process.env.PROTOTYPE_TEST_IMAGE;
const temporary = mkdtempSync(join(tmpdir(), "eventclear-disposable-"));
const handles = [],
  servers = [],
  logs = [],
  sockets = new Set();
let api, indexer;
const cert = {
  key: readFileSync(join(directory, "key.pem")),
  cert: readFileSync(join(directory, "cert.pem")),
};
function start(command, args, env = process.env) {
  const fd = openSync(join(temporary, `child-${logs.length}.log`), "w");
  logs.push(fd);
  const p = spawn(command, args, { env, stdio: ["ignore", fd, fd] });
  handles.push(p);
  return p;
}
async function stop(p) {
  if (p && p.exitCode === null && p.signalCode === null) {
    const ended = new Promise((r) => p.once("exit", r));
    p.kill("SIGTERM");
    const timer = setTimeout(() => p.kill("SIGKILL"), 3000);
    await ended;
    clearTimeout(timer);
  }
}
async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(`DISPOSABLE_TIMEOUT:${label}`);
}
async function listen(server, port) {
  servers.push(server);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
}
try {
  const anvil = start("anvil", [
    "--silent",
    "--port",
    "8560",
    "--chain-id",
    "11155111",
    "--block-time",
    "1",
  ]);
  const client = createPublicClient({
    transport: http("http://127.0.0.1:8560"),
  });
  await waitFor(() => client.getChainId(), "anvil");
  assert.equal(
    anvil.exitCode,
    null,
    "Disposable RPC port must not already belong to another process",
  );
  // HTTPS reverse proxy supplies a test-only trusted TLS endpoint to the unchanged API.
  await listen(
    httpsServer(cert, (req, res) => {
      const target = req.url.startsWith("/api/")
        ? image
          ? "http://127.0.0.1:10000"
          : "http://127.0.0.1:8060"
        : "http://127.0.0.1:8560";
      const upstream = plainRequest(
        new URL(req.url, target),
        {
          method: req.method,
          headers: { ...req.headers, "x-forwarded-proto": "https" },
        },
        (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(503);
        res.end();
      });
      req.pipe(upstream);
    }),
    9460,
  );
  await listen(
    tlsServer(cert, (socket) => {
      const upstream = connect(6389, "127.0.0.1");
      socket.pipe(upstream).pipe(socket);
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    }),
    9461,
  );
  const keys = Array.from({ length: 5 }, () => generatePrivateKey());
  const accounts = keys.map(privateKeyToAccount);
  for (const account of accounts)
    await client.request({
      method: "anvil_setBalance",
      params: [account.address, "0x8ac7230489e80000"],
    });
  const fixturePath = join(temporary, "fixture.json");
  execFileSync(
    "python",
    ["scripts/aws/generate-staging-fixture.py", fixturePath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const env = {
    ...process.env,
    ...limits,
    STAGING_CHAIN_ID: "11155111",
    STAGING_TEST_ASSETS_ONLY: "true",
    ENABLE_MAINNET_EXECUTION: "false",
    PUBLIC_CAPITAL_ACTIVATED: "false",
    STAGING_DEPLOYER_PRIVATE_KEY: keys[0],
    STAGING_DEPLOYER_ADDRESS: accounts[0].address,
    STAGING_ADMIN_ADDRESS: accounts[1].address,
    RISK_SIGNER_ADDRESS: accounts[2].address,
    STAGING_LP_ADDRESS: accounts[3].address,
    STAGING_TEST_EOA: accounts[4].address,
    STAGING_RELATIONSHIP_HASH: fixture.relationship.canonicalDefinitionHash,
    STAGING_RULES_HASH: fixture.relationship.resolutionRulesHash,
    STAGING_EARLIEST_RESOLUTION: String(
      fixture.relationship.earliestResolutionTimestamp,
    ),
    STAGING_LATEST_RESOLUTION: String(
      fixture.relationship.latestResolutionTimestamp,
    ),
    STAGING_RPC_PRIMARY: "http://127.0.0.1:8560",
    EVENTCLEAR_MODE: "testnet-prototype",
  };
  execFileSync(
    "forge",
    [
      "script",
      "script/DeployStaging.s.sol:DeployStaging",
      "--rpc-url",
      env.STAGING_RPC_PRIMARY,
      "--broadcast",
    ],
    {
      cwd: "packages/contracts",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const broadcast = JSON.parse(
    readFileSync(
      "packages/contracts/broadcast/DeployStaging.s.sol/11155111/run-latest.json",
      "utf8",
    ),
  );
  const names = {
    MockPUSD: "collateralToken",
    MockConditionalTokens: "conditionalTokens",
    MockResolutionOracle: "resolutionOracle",
    MockCTFAdapter: "standardAdapter",
    RelationshipRegistry: "relationshipRegistry",
    RiskPolicy: "riskPolicy",
    EventClearClaims: "claims",
    EventClearTreasury: "treasury",
    EventClearFundingPool: "fundingPool",
    EventClearVault: "vault",
  };
  const payload = {
    environment: "testnet-prototype",
    chainId: 11155111,
    contracts: Object.fromEntries(
      broadcast.transactions
        .filter((t) => t.transactionType === "CREATE")
        .map((t) => [names[t.contractName], { address: t.contractAddress }]),
    ),
  };
  // Foundry serializes addresses lowercase; normalize to checksummed manifest form.
  const { getAddress } = await import("viem");
  for (const c of Object.values(payload.contracts))
    c.address = getAddress(c.address);
  const manifest = {
    ...payload,
    manifestHash:
      "0x" + createHash("sha256").update(canonical(payload)).digest("hex"),
  };
  const manifestPath = join(temporary, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  await verifyDeployment(manifest, env);
  execFileSync("python", ["scripts/aws/migrate.py"], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.PROTOTYPE_TEST_DATABASE_URL,
      MIGRATIONS_DIR: "infrastructure/docker/postgres/migrations",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appEnv = {
    ...process.env,
    EVENTCLEAR_MODE: "testnet-prototype",
    CHAIN_ID: "11155111",
    TESTNET_ASSETS_ONLY: "true",
    ENABLE_MAINNET_EXECUTION: "false",
    PUBLIC_CAPITAL_ACTIVATED: "false",
    PROTOTYPE_MAX_MONTHLY_COST_USD: "0",
    EVENTCLEAR_STORE: "postgres",
    ADVANCE_RATIO_BPS: "9000",
    DATABASE_URL: process.env.PROTOTYPE_TEST_DATABASE_URL,
    REDIS_URL: "rediss://localhost:9461",
    SOLVER_URL: "http://127.0.0.1:8001",
    ADMIN_API_TOKEN: "a".repeat(48),
    SIWE_SESSION_SECRET: "b".repeat(48),
    STAGING_ACCESS_TOKEN: "c".repeat(48),
    SIWE_DOMAIN: "localhost:9460",
    SIWE_URI: "https://localhost:9460",
    CONTRACT_MANIFEST_PATH: manifestPath,
    STAGING_FIXTURE_PATH: fixturePath,
    RISK_SIGNER_BACKEND: "local",
    RISK_SIGNER_PRIVATE_KEY: keys[2],
    RISK_SIGNER_ADDRESS: accounts[2].address,
    PROTOTYPE_DEPLOYER_ADDRESS: accounts[0].address,
    PROTOTYPE_ADMIN_ADDRESS: accounts[1].address,
    PROTOTYPE_LP_ADDRESS: accounts[3].address,
    PROTOTYPE_TESTER_ADDRESS: accounts[4].address,
    LP_ALLOWLIST: accounts[3].address,
    TESTER_ALLOWLIST: accounts[4].address,
    ADMIN_ALLOWLIST: accounts[1].address,
    POLYGON_RPC_URLS: "https://localhost:9460",
    RPC_REDUNDANCY_DEGRADED: "true",
    INDEXER_CONFIRMATIONS: "0",
    INDEXER_START_BLOCK: String(
      Math.min(...broadcast.receipts.map((r) => Number(BigInt(r.blockNumber)))),
    ),
  };
  for (const [variable, key] of Object.entries({
    VAULT_ADDRESS: "vault",
    FUNDING_POOL_ADDRESS: "fundingPool",
    COLLATERAL_TOKEN_ADDRESS: "collateralToken",
    CTF_ADDRESS: "conditionalTokens",
    STANDARD_CTF_ADAPTER_ADDRESS: "standardAdapter",
    RISK_POLICY_ADDRESS: "riskPolicy",
    RELATIONSHIP_REGISTRY_ADDRESS: "relationshipRegistry",
    CLAIMS_ADDRESS: "claims",
    TREASURY_ADDRESS: "treasury",
  }))
    appEnv[variable] = manifest.contracts[key].address;
  if (!image)
    start(
      "python",
      [
        "-m",
        "uvicorn",
        "eventclear_solver.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8001",
        "--no-access-log",
      ],
      appEnv,
    );
  function container(env) {
    const values = {
      ...env,
      PROTOTYPE_MANIFEST_JSON: JSON.stringify(manifest),
      PROTOTYPE_FIXTURE_JSON: JSON.stringify(fixture),
      PORT: "10000",
    };
    const args = [
      "run",
      "--rm",
      "--name",
      "eventclear-disposable-runtime",
      "--network=host",
      "--memory=512m",
      "--cpus=1",
      "-v",
      `${join(directory, "cert.pem")}:${join(directory, "cert.pem")}:ro`,
    ];
    for (const key of Object.keys(values)) args.push("--env", key);
    args.push(image);
    return start("docker", args, values);
  }
  async function boot() {
    if (image) api = container(appEnv);
    else {
      api = start(
        "python",
        [
          "-m",
          "uvicorn",
          "eventclear_api.main:app",
          "--host",
          "127.0.0.1",
          "--port",
          "8060",
          "--no-access-log",
        ],
        appEnv,
      );
      indexer = start(
        "node",
        ["--import", "tsx", "apps/indexer/src/index.ts", "run"],
        appEnv,
      );
    }
    await waitFor(async () => {
      const r = await fetch("https://localhost:9460/api/v1/readiness");
      return r.ok;
    }, "API dependencies");
  }
  await boot();
  Object.assign(process.env, {
    STAGING_RPC_PRIMARY: env.STAGING_RPC_PRIMARY,
    RISK_SIGNER_ADDRESS: accounts[2].address,
    PROTOTYPE_PREVIOUS_SHA: "a".repeat(40),
  });
  const evidence = await executeLifecycle({
    prototype: true,
    disposable: true,
    chainId: 11155111,
    o: { ApiUrl: "https://localhost:9460", WebUrl: "https://localhost:9460" },
    actors: { deployer: accounts[0], lp: accounts[3], tester: accounts[4] },
    manifest,
    fixture,
    runtime: { accessToken: appEnv.STAGING_ACCESS_TOKEN },
    restartHost: async () => {
      await stop(api);
      await stop(indexer);
      await boot();
      return { kind: "disposable-process-restart" };
    },
    runUi: async () => {},
  });
  assert.equal(evidence.status, "DISPOSABLE_LIFECYCLE_PASSED");
  await stop(api);
  const badRedisLog = logs.length;
  const unavailable = image
    ? container({ ...appEnv, REDIS_URL: "rediss://localhost:9462" })
    : start(
        "python",
        [
          "-m",
          "uvicorn",
          "eventclear_api.main:app",
          "--host",
          "127.0.0.1",
          "--port",
          "8060",
          "--no-access-log",
        ],
        { ...appEnv, REDIS_URL: "rediss://localhost:9462" },
      );
  await waitFor(
    () => unavailable.exitCode !== null || unavailable.signalCode !== null,
    "Redis fail-closed exit",
  );
  assert.notEqual(unavailable.exitCode, 0);
  assert.ok(
    readFileSync(join(temporary, `child-${badRedisLog}.log`), "utf8").includes(
      "REDIS_RATE_LIMITER_UNAVAILABLE",
    ),
  );
  evidence.redisUnavailable = "SOFTWARE FAILURE PATH VERIFIED";
  console.log(
    JSON.stringify({
      status: evidence.status,
      accounting: evidence.accounting,
      restart: evidence.restart,
      rollback: evidence.rollback,
      redisUnavailable: evidence.redisUnavailable,
    }),
  );
} catch (error) {
  // Local fixture logs contain no actor keys; still print only final error codes.
  console.error(
    "DISPOSABLE_PROTOTYPE_FAILED",
    String(error?.message).slice(0, 160),
  );
  for (let i = 0; i < logs.length; i++) {
    const text = readFileSync(join(temporary, `child-${i}.log`), "utf8");
    writeFileSync(`/tmp/eventclear-prototype-child-${i}.log`, text);
  }
  process.exitCode = 1;
} finally {
  for (const p of handles.reverse()) await stop(p);
  if (image)
    try {
      execFileSync("docker", ["rm", "-f", "eventclear-disposable-runtime"], {
        stdio: "ignore",
      });
    } catch {}
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
  for (const fd of logs) closeSync(fd);
  rmSync(temporary, { recursive: true, force: true });
}
