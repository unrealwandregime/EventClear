import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
const files = [
  "config/contracts/staging.json",
  "config/staging/deployed.json",
  "docs/STAGING_DEPLOYMENT_RECORD.md",
  "docs/STAGING_LIFECYCLE_EVIDENCE.md",
  "docs/STAGING_MONITORING_EVIDENCE.md",
];
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw Error("CLEAN_CHECKOUT_REQUIRED");
// Run only in a dedicated clean checkout; download is verified before promotion.
execFileSync("node", ["scripts/aws/restore-evidence.mjs"], {
  stdio: "inherit",
});
const branch = `codex/staging-evidence-${process.env.EVIDENCE_RUN_ID}`;
execFileSync("git", ["checkout", "-b", branch]);
execFileSync("git", ["add", "--", ...files.filter(existsSync)]);
execFileSync("git", [
  "commit",
  "-m",
  "docs: record verified staging deployment evidence",
]);
execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
execFileSync(
  "gh",
  [
    "pr",
    "create",
    "--repo",
    "unrealwandregime/EventClear",
    "--base",
    "master",
    "--head",
    branch,
    "--title",
    "Record verified staging deployment evidence",
    "--body",
    "Generated from a verified successful protected staging workflow. Review the non-mainnet manifest and sanitized evidence before merge.",
  ],
  { stdio: "inherit" },
);
