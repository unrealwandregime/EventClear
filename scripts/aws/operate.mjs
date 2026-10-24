import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { aws, requireEnv, assertStaging, isMain } from "./common.mjs";
import { readOutputs } from "./read-staging-outputs.mjs";
import { derive } from "./derive-kms-ethereum-address.mjs";
import { validateChain } from "./validate-chain.mjs";
import { deriveActors, verifyDeployment } from "./deploy-contracts.mjs";
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
function awsInput(args, value) {
  return aws([...args, "--cli-input-json", "file:///dev/stdin"], value);
}
const secret = (id) =>
  JSON.parse(
    aws(["secretsmanager", "get-secret-value", "--secret-id", id]).SecretString,
  );
const outputDir = "outputs/staging";
function record(name, value) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    `${outputDir}/${name}.json`,
    JSON.stringify(value, null, 2) + "\n",
  );
}
const sha = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
export function provisionParameters(env = process.env) {
  requireEnv(
    [
      "STAGING_DOMAIN",
      "STAGING_HOSTED_ZONE_ID",
      "STAGING_ALERT_EMAIL",
      "STAGING_BUDGET_USD",
    ],
    env,
  );
  if (env.ALLOW_AWS_PROVISION !== "true")
    throw Error("ALLOW_AWS_PROVISION=true_REQUIRED");
  if (
    !/^\d+(\.\d{1,2})?$/.test(env.STAGING_BUDGET_USD) ||
    Number(env.STAGING_BUDGET_USD) <= 0
  )
    throw Error("EXPLICIT_POSITIVE_BUDGET_REQUIRED");
  return {
    DomainName: env.STAGING_DOMAIN,
    HostedZoneId: env.STAGING_HOSTED_ZONE_ID,
    AlertEmail: env.STAGING_ALERT_EMAIL,
    BudgetUsd: env.STAGING_BUDGET_USD,
    AllowProvision: "true",
  };
}
function provision() {
  requireEnv([
    "AWS_REGION",
    "STAGING_STACK_NAME",
    "AWS_STACK_EXECUTION_ROLE_ARN",
  ]);
  if (
    !/^eventclear-staging(?:-[a-z0-9-]+)?$/.test(process.env.STAGING_STACK_NAME)
  )
    throw Error("STAGING_STACK_NAME_REQUIRED");
  if (!process.env.STAGING_HOSTED_ZONE_ID) {
    const zones = aws(["route53", "list-hosted-zones"])
      .HostedZones.filter(
        (z) =>
          !z.Config?.PrivateZone &&
          (process.env.STAGING_DOMAIN + ".").endsWith(z.Name),
      )
      .sort((a, b) => b.Name.length - a.Name.length);
    if (!zones.length || zones[1]?.Name === zones[0].Name)
      throw Error("UNAMBIGUOUS_PUBLIC_HOSTED_ZONE_REQUIRED");
    process.env.STAGING_HOSTED_ZONE_ID = zones[0].Id.replace(
      "/hostedzone/",
      "",
    );
  }
  const params = provisionParameters();
  execFileSync(
    "aws",
    [
      "cloudformation",
      "deploy",
      "--template-file",
      "infrastructure/aws/staging/template.json",
      "--stack-name",
      process.env.STAGING_STACK_NAME,
      "--role-arn",
      process.env.AWS_STACK_EXECUTION_ROLE_ARN,
      "--capabilities",
      "CAPABILITY_NAMED_IAM",
      "--parameter-overrides",
      ...Object.entries(params).map(([k, v]) => `${k}=${v}`),
      "--tags",
      "Project=EventClearStaging",
      "--no-fail-on-empty-changeset",
    ],
    { stdio: "inherit" },
  );
  record("infrastructure", {
    gitSha: sha(),
    stackName: process.env.STAGING_STACK_NAME,
    status: "provisioned",
    at: new Date().toISOString(),
  });
}
export function taskDefinition(service, image, o, manifest, env = process.env) {
  if (!o.RuntimeSecretVersion)
    throw Error("PINNED_RUNTIME_SECRET_VERSION_REQUIRED");
  if (!/:[0-9a-f]{40}$/.test(image)) throw Error("FULL_SHA_IMAGE_TAG_REQUIRED");
  const region = env.AWS_REGION;
  const name = env.STAGING_STACK_NAME;
  const nonsecret = {
    EVENTCLEAR_MODE: "staging",
    EVENTCLEAR_STORE: "postgres",
    CHAIN_ID: String(manifest.chainId),
    STAGING_TEST_ASSETS_ONLY: "true",
    ENABLE_MAINNET_EXECUTION: "false",
    PUBLIC_CAPITAL_ACTIVATED: "false",
    STAGING_STACK_NAME: name,
    AWS_REGION: region,
  };
  const addrs = {
    vault: "VAULT_ADDRESS",
    claims: "CLAIMS_ADDRESS",
    fundingPool: "FUNDING_POOL_ADDRESS",
    collateralToken: "COLLATERAL_TOKEN_ADDRESS",
    standardAdapter: "STANDARD_CTF_ADAPTER_ADDRESS",
    conditionalTokens: "CTF_ADDRESS",
    relationshipRegistry: "RELATIONSHIP_REGISTRY_ADDRESS",
    treasury: "TREASURY_ADDRESS",
    riskPolicy: "RISK_POLICY_ADDRESS",
  };
  for (const [k, n] of Object.entries(addrs))
    nonsecret[n] = manifest.contracts[k].address;
  Object.assign(nonsecret, {
    CONTRACT_MANIFEST_PATH: "config/contracts/staging.json",
    RISK_SIGNER_BACKEND: "kms",
    RISK_SIGNER_ADDRESS: env.RISK_SIGNER_ADDRESS,
    RISK_SIGNER_KMS_KEY_ID: o.RiskKeyArn,
    RISK_SIGNER_KMS_REGION: region,
    SOLVER_URL: `http://solver.${o.ServiceNamespaceName}:8001`,
    OBJECT_STORAGE_BUCKET: o.ArtifactBucket,
    OBJECT_STORAGE_REGION: region,
    SIWE_DOMAIN: new URL(o.WebUrl).host,
    SIWE_URI: o.WebUrl,
    LP_ALLOWLIST: env.STAGING_LP_ADDRESS,
    TESTER_ALLOWLIST: env.STAGING_TEST_EOA,
    ADMIN_ALLOWLIST: env.STAGING_ADMIN_ADDRESS,
    ADVANCE_RATIO_BPS: "9000",
    CONTRACTS_DEPLOYED: "true",
    INDEXER_CONFIRMATIONS: "2",
    INDEXER_START_BLOCK: env.STAGING_DEPLOYMENT_BLOCK ?? "0",
  });
  if (service === "migration") nonsecret.CREATE_TARGET_DATABASE = "true";
  const secrets = [];
  const inject = (name, key) =>
    secrets.push({
      name,
      valueFrom: `${o.RuntimeSecretArn}:${key}::${o.RuntimeSecretVersion ?? ""}`,
    });
  if (["api", "indexer", "migration"].includes(service))
    inject("DATABASE_URL", "databaseUrl");
  if (["api", "indexer"].includes(service))
    inject("POLYGON_RPC_URLS", "rpcUrls");
  if (service === "api") {
    inject("STAGING_MANIFEST_JSON", "manifestJson");
    inject("STAGING_FIXTURE_JSON", "fixtureJson");
    inject("REDIS_URL", "redisUrl");
    inject("ADMIN_API_TOKEN", "adminToken");
    inject("SIWE_SESSION_SECRET", "sessionSecret");
    inject("STAGING_ACCESS_TOKEN", "accessToken");
  }
  if (service === "web") inject("STAGING_ACCESS_TOKEN", "accessToken");
  const commands = {
    api: ["python", "/app/api-entrypoint.py"],
    solver: [
      "uvicorn",
      "eventclear_solver.main:app",
      "--host",
      "0.0.0.0",
      "--port",
      "8001",
    ],
    web: ["node", "scripts/aws/staging-gateway.mjs"],
    indexer: ["node", "--import", "tsx", "apps/indexer/src/index.ts", "run"],
    migration: ["python", "/app/migrate.py"],
  };
  const ports = { api: 8000, web: 3000, solver: 8001 };
  const title = service[0].toUpperCase() + service.slice(1);
  const container = {
    name: service,
    image,
    essential: true,
    command: commands[service],
    environment: Object.entries(nonsecret)
      .filter(([, v]) => v !== undefined)
      .map(([name, value]) => ({ name, value: String(value) })),
    secrets,
    logConfiguration: {
      logDriver: "awslogs",
      options: {
        "awslogs-group": `/eventclear/${name}/${service}`,
        "awslogs-region": region,
        "awslogs-stream-prefix": "ecs",
      },
    },
  };
  if (ports[service])
    container.portMappings = [
      { containerPort: ports[service], protocol: "tcp" },
    ];
  if (["api", "solver"].includes(service))
    container.healthCheck = {
      command: [
        "CMD",
        "python",
        "-c",
        `import urllib.request; urllib.request.urlopen('http://localhost:${ports[service]}/${service === "api" ? "api/v1/readiness" : "health"}',timeout=5)`,
      ],
      interval: 30,
      timeout: 10,
      retries: 3,
      startPeriod: 60,
    };
  if (service === "indexer")
    container.healthCheck = {
      command: [
        "CMD", "node", "--import", "tsx", "apps/indexer/src/index.ts", "health",
      ],
      interval: 60,
      timeout: 30,
      retries: 3,
      startPeriod: 120,
    };
  return {
    family: `${name}-${service}`,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: service === "web" ? "512" : "256",
    memory: service === "web" ? "2048" : "512",
    executionRoleArn: o.ExecutionRoleArn,
    taskRoleArn: o[`${title}TaskRoleArn`],
    containerDefinitions: [container],
  };
}
async function configureRuntime(o) {
  const accounts = deriveActors();
  const db = secret(o.DatabaseSecretArn),
    redis = aws([
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      o.RedisAuthSecretArn,
    ]).SecretString;
  const existing = secret(o.RuntimeSecretArn);
  const value = {
    ...existing,
    databaseUrl: `postgresql://${encodeURIComponent(db.username)}:${encodeURIComponent(db.password)}@${o.DatabaseEndpoint}:5432/eventclear_${json("config/contracts/staging.json").manifestHash.slice(2, 18)}?sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem`,
    redisUrl: `rediss://:${encodeURIComponent(redis)}@${o.RedisEndpoint}:6379/0`,
    manifestJson: JSON.stringify(json("config/contracts/staging.json")),
    fixtureJson: JSON.stringify(json("config/staging/deployed.json")),
    rpcUrls: [
      process.env.STAGING_RPC_PRIMARY,
      process.env.STAGING_RPC_FALLBACK,
    ].join(","),
    adminToken: existing.adminToken ?? randomBytes(32).toString("hex"),
    sessionSecret: existing.sessionSecret ?? randomBytes(32).toString("hex"),
  };
  o.RuntimeSecretVersion = awsInput(["secretsmanager", "put-secret-value"], {
    SecretId: o.RuntimeSecretArn,
    SecretString: JSON.stringify(value),
  }).VersionId;
  process.env.RISK_SIGNER_ADDRESS = await derive(o.RiskKeyArn);
  return accounts;
}
function network(o, svc) {
  return {
    awsvpcConfiguration: {
      subnets: o.TaskSubnets.split(","),
      securityGroups: [
        o[`${svc[0].toUpperCase() + svc.slice(1)}SecurityGroup`],
      ],
      assignPublicIp: "ENABLED",
    },
  };
}
function discoverService(cluster, name) {
  const r = aws([
    "ecs",
    "describe-services",
    "--cluster",
    cluster,
    "--services",
    name,
  ]);
  if ((r.failures ?? []).some((f) => f.reason !== "MISSING"))
    throw Error("ECS_SERVICE_LOOKUP_FAILED");
  return r.services?.find((s) => s.status === "ACTIVE");
}
function registry(o, name) {
  const found = aws([
    "servicediscovery",
    "list-services",
    "--filters",
    `Name=NAMESPACE_ID,Values=${o.ServiceNamespaceId},Condition=EQ`,
  ]).Services?.find((s) => s.Name === name);
  return (
    found?.Arn ??
    awsInput(["servicediscovery", "create-service"], {
      Name: name,
      NamespaceId: o.ServiceNamespaceId,
      DnsConfig: {
        NamespaceId: o.ServiceNamespaceId,
        RoutingPolicy: "MULTIVALUE",
        DnsRecords: [{ Type: "A", TTL: 10 }],
      },
      HealthCheckCustomConfig: { FailureThreshold: 1 },
    }).Service.Arn
  );
}
function rollback(o, previous) {
  for (const [svc, task] of Object.entries(previous)) {
    if (task)
      aws([
        "ecs",
        "update-service",
        "--cluster",
        o.ClusterArn,
        "--service",
        `${process.env.STAGING_STACK_NAME}-${svc}`,
        "--task-definition",
        task,
      ]);
    else if (
      discoverService(o.ClusterArn, `${process.env.STAGING_STACK_NAME}-${svc}`)
    )
      aws([
        "ecs",
        "update-service",
        "--cluster",
        o.ClusterArn,
        "--service",
        `${process.env.STAGING_STACK_NAME}-${svc}`,
        "--desired-count",
        "0",
      ]);
  }
}
async function checkHealth(o) {
  const accessToken = secret(o.RuntimeSecretArn).accessToken;
  const page = await fetch(`${o.WebUrl}/app`, {
    headers: { "x-staging-access": accessToken },
    signal: AbortSignal.timeout(30000),
  });
  if (!page.ok || !(await page.text()).includes("EventClear"))
    throw Error("REMOTE_WEB_RENDER_FAILED");
  for (const path of ["/api/v1/health", "/api/v1/readiness", "/health"]) {
    const response = await fetch(`${o.WebUrl}${path}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error(`REMOTE_HEALTH_FAILED:${path}`);
  }
}
async function deployServices() {
  const chainId = assertStaging();
  const o = readOutputs();
  const manifest = json("config/contracts/staging.json");
  if (manifest.environment !== "staging" || manifest.chainId !== chainId)
    throw Error("VERIFIED_STAGING_MANIFEST_REQUIRED");
  await validateChain(
    process.env,
    Object.values(manifest.contracts).map((c) => c.address),
  );
  const contractEvidence = json("outputs/staging/contracts.json");
  if (!contractEvidence.receipts?.length)
    throw Error("DEPLOYMENT_RECEIPTS_REQUIRED");
  const firstBlock = contractEvidence.receipts
    .map((r) => BigInt(r.blockNumber))
    .reduce((a, b) => (a < b ? a : b));
  process.env.STAGING_DEPLOYMENT_BLOCK = String(
    firstBlock > 0n ? firstBlock - 1n : 0n,
  );
  const accounts = deriveActors();
  for (const [role, account] of Object.entries(accounts)) {
    if (
      contractEvidence.actors[role]?.toLowerCase() !==
      account.address.toLowerCase()
    )
      throw Error("DEPLOYMENT_ACTOR_MISMATCH");
  }
  process.env.STAGING_RELATIONSHIP_HASH = json(
    "config/staging/deployed.json",
  ).relationship.canonicalDefinitionHash;
  await configureRuntime(o);
  await verifyDeployment(manifest);
  const previous = {};
  for (const svc of ["web", "api", "solver", "indexer"])
    previous[svc] =
      discoverService(o.ClusterArn, `${process.env.STAGING_STACK_NAME}-${svc}`)
        ?.taskDefinition ?? null;
  record("previous-task-definitions", {
    gitSha: sha(),
    cluster: o.ClusterArn,
    previous,
  });
  const definitions = {};
  for (const svc of ["migration", "api", "solver", "indexer", "web"])
    definitions[svc] = awsInput(
      ["ecs", "register-task-definition"],
      taskDefinition(svc, `${o.EcrPrefix}-${svc}:${sha()}`, o, manifest),
    ).taskDefinition.taskDefinitionArn;
  const run = awsInput(["ecs", "run-task"], {
    cluster: o.ClusterArn,
    launchType: "FARGATE",
    taskDefinition: definitions.migration,
    networkConfiguration: network(o, "migration"),
  });
  if (run.failures?.length || !run.tasks?.[0]?.taskArn)
    throw Error("MIGRATION_TASK_START_FAILED");
  const migration = run.tasks[0].taskArn;
  aws([
    "ecs",
    "wait",
    "tasks-stopped",
    "--cluster",
    o.ClusterArn,
    "--tasks",
    migration,
  ]);
  const stopped = aws([
    "ecs",
    "describe-tasks",
    "--cluster",
    o.ClusterArn,
    "--tasks",
    migration,
  ]).tasks?.[0];
  if (stopped?.containers?.[0]?.exitCode !== 0)
    throw Error("MIGRATION_TASK_FAILED");
  try {
    for (const svc of ["solver", "api", "indexer", "web"]) {
      const name = `${process.env.STAGING_STACK_NAME}-${svc}`;
      if (previous[svc])
        awsInput(["ecs", "update-service"], {
          cluster: o.ClusterArn,
          service: name,
          taskDefinition: definitions[svc],
          desiredCount: 1,
          forceNewDeployment: true,
        });
      else {
        const input = {
          cluster: o.ClusterArn,
          serviceName: name,
          taskDefinition: definitions[svc],
          desiredCount: 1,
          launchType: "FARGATE",
          networkConfiguration: network(o, svc),
          deploymentConfiguration: {
            deploymentCircuitBreaker: { enable: true, rollback: true },
            maximumPercent: 200,
            minimumHealthyPercent: 100,
          },
        };
        if (["api", "solver"].includes(svc))
          input.serviceRegistries = [{ registryArn: registry(o, svc) }];
        if (["api", "web"].includes(svc))
          input.loadBalancers = [
            {
              targetGroupArn:
                o[svc === "api" ? "ApiTargetGroupArn" : "WebTargetGroupArn"],
              containerName: svc,
              containerPort: svc === "api" ? 8000 : 3000,
            },
          ];
        awsInput(["ecs", "create-service"], input);
      }
    }
    aws([
      "ecs",
      "wait",
      "services-stable",
      "--cluster",
      o.ClusterArn,
      "--services",
      ...["web", "api", "solver", "indexer"].map(
        (s) => `${process.env.STAGING_STACK_NAME}-${s}`,
      ),
    ]);
    const deployed = aws([
      "ecs",
      "describe-services",
      "--cluster",
      o.ClusterArn,
      "--services",
      ...["web", "api", "solver", "indexer"].map(
        (s) => `${process.env.STAGING_STACK_NAME}-${s}`,
      ),
    ]).services;
    for (const svc of ["web", "api", "solver", "indexer"]) {
      const current = deployed.find(
        (s) => s.serviceName === `${process.env.STAGING_STACK_NAME}-${svc}`,
      );
      if (
        current?.taskDefinition !== definitions[svc] ||
        current.runningCount !== 1
      )
        throw Error("ECS_DEPLOYMENT_ROLLED_BACK_OR_UNHEALTHY");
    }
    await checkHealth(o);
  } catch (error) {
    rollback(o, previous);
    throw error;
  }
  record("service-deployment", {
    gitSha: sha(),
    definitions,
    previous,
    migrationTask: migration,
    at: new Date().toISOString(),
    health: "passed",
  });
}
async function monitoringCheck() {
  const o = readOutputs();
  const confirmed = aws([
    "sns",
    "list-subscriptions-by-topic",
    "--topic-arn",
    o.AlertTopicArn,
  ]).Subscriptions?.filter((s) => s.SubscriptionArn !== "PendingConfirmation");
  if (!confirmed?.length) throw Error("CONFIRMED_ALERT_SUBSCRIPTION_REQUIRED");
  const triggered = new Date().toISOString();
  aws([
    "cloudwatch",
    "set-alarm-state",
    "--alarm-name",
    o.TestAlarmName,
    "--state-value",
    "ALARM",
    "--state-reason",
    "Controlled EventClear staging delivery test",
  ]);
  // A successful API call is NOT delivery evidence. Operator must independently confirm receipt.
  record("monitoring-trigger", {
    at: triggered,
    alarm: o.TestAlarmName,
    status: "TRIGGERED_DELIVERY_UNCONFIRMED",
  });
  aws([
    "cloudwatch",
    "set-alarm-state",
    "--alarm-name",
    o.TestAlarmName,
    "--state-value",
    "OK",
    "--state-reason",
    "Controlled test complete",
  ]);
  console.log(
    "Test alarm triggered and returned to OK. SNS delivery remains unconfirmed until recipient evidence is supplied.",
  );
}
async function destroy() {
  requireEnv(["STAGING_STACK_NAME"]);
  if (
    process.env.ALLOW_STAGING_DESTROY !== process.env.STAGING_STACK_NAME ||
    !/^eventclear-staging(?:-[a-z0-9-]+)?$/.test(process.env.STAGING_STACK_NAME)
  )
    throw Error("EXPLICIT_STAGING_DESTROY_CONFIRMATION_REQUIRED");
  const o = readOutputs();
  for (const svc of ["web", "api", "solver", "indexer"]) {
    const name = `${process.env.STAGING_STACK_NAME}-${svc}`;
    if (discoverService(o.ClusterArn, name)) {
      aws([
        "ecs",
        "update-service",
        "--cluster",
        o.ClusterArn,
        "--service",
        name,
        "--desired-count",
        "0",
      ]);
      aws([
        "ecs",
        "delete-service",
        "--cluster",
        o.ClusterArn,
        "--service",
        name,
        "--force",
      ]);
    }
  }
  // Drain Cloud Map registrations before deleting the namespace. Retained S3/KMS/RDS snapshots are documented.
  const services =
    aws([
      "servicediscovery",
      "list-services",
      "--filters",
      `Name=NAMESPACE_ID,Values=${o.ServiceNamespaceId},Condition=EQ`,
    ]).Services ?? [];
  for (const s of services) {
    const deadline = Date.now() + 180000;
    let instances;
    do {
      instances =
        aws(["servicediscovery", "list-instances", "--service-id", s.Id])
          .Instances ?? [];
      if (!instances.length) break;
      await new Promise((r) => setTimeout(r, 3000));
    } while (Date.now() < deadline);
    if (instances.length) throw Error("ECS_SERVICE_DRAIN_TIMEOUT");
    aws(["servicediscovery", "delete-service", "--id", s.Id]);
  }
  record("retained-resources", {
    artifactBucket: o.ArtifactBucket,
    riskKeyArn: o.RiskKeyArn,
    databaseSnapshot:
      "CloudFormation final RDS snapshot; inspect stack deletion events",
    note: "These evidence-preservation resources may continue to incur charges. Delete only after explicitly reviewing retention needs.",
  });
  aws([
    "cloudformation",
    "delete-stack",
    "--stack-name",
    process.env.STAGING_STACK_NAME,
  ]);
  aws([
    "cloudformation",
    "wait",
    "stack-delete-complete",
    "--stack-name",
    process.env.STAGING_STACK_NAME,
  ]);
}
export async function operate(action) {
  if (action === "provision-infra") return provision();
  if (action === "destroy-infra") return destroy();
  if (action === "deploy-services") return deployServices();
  if (action === "monitoring-check") return monitoringCheck();
  if (action === "rollback-services") {
    const o = readOutputs(),
      r = json(
        process.env.STAGING_ROLLBACK_RECORD ??
          `${outputDir}/previous-task-definitions.json`,
      );
    if (r.cluster !== o.ClusterArn) throw Error("ROLLBACK_CLUSTER_MISMATCH");
    for (const [service, arn] of Object.entries(r.previous))
      if (
        !["web", "api", "solver", "indexer"].includes(service) ||
        !arn?.includes(
          `task-definition/${process.env.STAGING_STACK_NAME}-${service}:`,
        )
      )
        throw Error("ROLLBACK_REVISION_INVALID");
    rollback(o, r.previous);
    aws([
      "ecs",
      "wait",
      "services-stable",
      "--cluster",
      o.ClusterArn,
      "--services",
      ...Object.keys(r.previous).map(
        (s) => `${process.env.STAGING_STACK_NAME}-${s}`,
      ),
    ]);
    await checkHealth(o);
    record("rollback", {
      at: new Date().toISOString(),
      status: "service-health-passed",
      taskDefinitions: r.previous,
    });
    return;
  }
  throw Error("UNKNOWN_STAGING_ACTION");
}
if (isMain(import.meta.url)) await operate(process.argv[2]);
