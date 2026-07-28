import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const runJson = (args) => {
  const command = process.env.npm_execpath ? process.execPath : "pnpm";
  const commandArgs = process.env.npm_execpath
    ? [process.env.npm_execpath, ...args]
    : args;
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!result.stdout) throw new Error(result.stderr || `pnpm ${args.join(" ")} failed`);
  return JSON.parse(result.stdout);
};

const production = runJson(["audit", "--prod", "--json"]);
const productionBlocking = Object.values(production.advisories ?? {}).filter(
  (advisory) => severityRank[advisory.severity] >= severityRank.high,
);
if (productionBlocking.length) {
  throw new Error(
    `PRODUCTION_HIGH_VULNERABILITY: ${productionBlocking
      .map((item) => item.github_advisory_id)
      .join(",")}`,
  );
}

const exceptions = JSON.parse(
  readFileSync("config/security/dependency-exceptions.json", "utf8"),
).exceptions;
const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(
  exceptions.map((item) => {
    if (item.scope !== "development-only" || item.expires < today) {
      throw new Error(`DEPENDENCY_EXCEPTION_INVALID_OR_EXPIRED:${item.advisoryId}`);
    }
    return [item.advisoryId, item];
  }),
);
const complete = runJson(["audit", "--json"]);
const unapproved = Object.values(complete.advisories ?? {}).filter((advisory) => {
  if (severityRank[advisory.severity] < severityRank.high) return false;
  const developmentOnly = advisory.findings.every((finding) => finding.dev === true);
  return !developmentOnly || !allowed.has(advisory.github_advisory_id);
});
if (unapproved.length) {
  throw new Error(
    `UNAPPROVED_HIGH_VULNERABILITY: ${unapproved
      .map((item) => item.github_advisory_id)
      .join(",")}`,
  );
}
console.log(
  `Dependency policy passed; production high/critical: 0, approved development exceptions: ${allowed.size}.`,
);
