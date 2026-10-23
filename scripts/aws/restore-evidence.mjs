import { execFileSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { requireEnv, canonical } from "./common.mjs";
requireEnv(["EVIDENCE_RUN_ID", "STAGING_ACTION"]);
if (!/^\d+$/.test(process.env.EVIDENCE_RUN_ID))
  throw Error("EVIDENCE_RUN_ID_REQUIRED");
const repo = "unrealwandregime/EventClear";
const run = JSON.parse(
  execFileSync(
    "gh",
    ["api", `repos/${repo}/actions/runs/${process.env.EVIDENCE_RUN_ID}`],
    { encoding: "utf8" },
  ),
);
if (
  run.conclusion !== "success" ||
  run.path !== ".github/workflows/staging-deploy.yml" ||
  run.head_repository?.full_name !== repo
)
  throw Error("UNTRUSTED_EVIDENCE_RUN");
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const rollback = process.env.STAGING_ACTION === "rollback-services";
const action =
  process.env.STAGING_ACTION === "promote-evidence"
    ? (process.env.STAGING_EVIDENCE_ACTION ?? "deploy-contracts")
    : rollback
      ? "deploy-services"
      : "deploy-contracts";
if (
  !["deploy-contracts", "deploy-services", "remote-lifecycle"].includes(action)
)
  throw Error("UNSUPPORTED_EVIDENCE_ACTION");
const directory = mkdtempSync(join(tmpdir(), "eventclear-evidence-"));
try {
  execFileSync(
    "gh",
    [
      "run",
      "download",
      process.env.EVIDENCE_RUN_ID,
      "--repo",
      repo,
      "--pattern",
      `staging-evidence-${action}-*`,
      "--dir",
      directory,
    ],
    { stdio: "inherit" },
  );
  const load = (file) =>
    JSON.parse(readFileSync(join(directory, file), "utf8"));
  if (rollback) {
    if (
      !existsSync(
        join(directory, "outputs/staging/previous-task-definitions.json"),
      )
    )
      throw Error("ROLLBACK_EVIDENCE_MISSING");
  } else {
    const evidence = load("outputs/staging/contracts.json"),
      manifest = load("config/contracts/staging.json");
    const { manifestHash, ...payload } = manifest;
    if (
      evidence.gitSha !== head ||
      evidence.manifestHash !== manifestHash ||
      manifestHash !==
        "0x" + createHash("sha256").update(canonical(payload)).digest("hex")
    )
      throw Error("EVIDENCE_HASH_OR_RELEASE_MISMATCH");
    if (action === "remote-lifecycle") {
      const lifecycle = load("outputs/staging/lifecycle.json");
      if (
        lifecycle.status !== "REMOTE_LIFECYCLE_PASSED" ||
        lifecycle.gitSha !== head ||
        lifecycle.manifestHash !== manifestHash
      )
        throw Error("LIFECYCLE_EVIDENCE_INVALID");
    }
  }
  const files = [
    "config/contracts/staging.json",
    "config/staging/deployed.json",
    "docs/STAGING_DEPLOYMENT_RECORD.md",
    "docs/STAGING_LIFECYCLE_EVIDENCE.md",
    "docs/STAGING_MONITORING_EVIDENCE.md",
  ];
  const outputs = join(directory, "outputs/staging");
  if (existsSync(outputs))
    for (const name of readdirSync(outputs))
      if (/^[a-z0-9-]+\.json$/.test(name))
        files.push("outputs/staging/" + name);
  for (const file of files) {
    const source = join(directory, file);
    if (!existsSync(source)) continue;
    mkdirSync(dirname(file), { recursive: true });
    copyFileSync(source, file);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
