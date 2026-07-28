import { spawnSync } from "node:child_process";

const command = process.env.npm_execpath ? process.execPath : "pnpm";
const args = process.env.npm_execpath
  ? [process.env.npm_execpath, "licenses", "list", "--json"]
  : ["licenses", "list", "--json"];
const result = spawnSync(command, args, {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (result.status !== 0 || !result.stdout) {
  throw new Error(result.stderr || "LICENSE_INVENTORY_FAILED");
}
const inventory = JSON.parse(result.stdout);
const deniedPattern = /\b(AGPL|GPL|SSPL|BUSL|Commons-Clause)\b/i;
const denied = Object.keys(inventory).filter((license) => deniedPattern.test(license));
if (denied.length) throw new Error(`DENIED_DEPENDENCY_LICENSE:${denied.join(",")}`);
console.log(
  `License policy passed (${Object.values(inventory).flat().length} package records checked).`,
);
