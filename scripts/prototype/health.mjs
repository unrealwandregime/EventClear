import { writeFileSync } from "node:fs";
const base = process.env.PROTOTYPE_URL;
if (!base?.startsWith("https://")) throw Error("PROTOTYPE_HTTPS_URL_REQUIRED");
const startedAt = new Date().toISOString();
const deadline = Date.now() + 5 * 60 * 1000;
let result;
while (Date.now() < deadline) {
  try {
    const response = await fetch(base + "/api/v1/readiness", {
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (
      response.ok &&
      data.status === "ready" &&
      ["database", "redis", "solver", "indexer"].every((k) => data[k] === true)
    ) {
      const web = await fetch(base + "/", {
        signal: AbortSignal.timeout(20000),
      });
      if (web.status !== 403) throw Error("ACCESS_BARRIER_REQUIRED");
      result = {
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "ready",
        database: true,
        redis: true,
        solver: true,
        indexer: true,
        accessBarrier: true,
      };
      break;
    }
  } catch {
    /* cold start, retry only during this intentional check */
  }
  await new Promise((r) => setTimeout(r, 15000));
}
if (!result) {
  console.error("PROTOTYPE_HEALTH_FAILED");
  process.exit(1);
}
writeFileSync("prototype-health.json", JSON.stringify(result, null, 2) + "\n");
console.log("PROTOTYPE_HEALTH_PASSED");
