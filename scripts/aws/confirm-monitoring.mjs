import { readFileSync, writeFileSync } from "node:fs";
import { requireEnv } from "./common.mjs";
requireEnv(["STAGING_ALERT_DELIVERY_REFERENCE", "STAGING_ALERT_RECEIVED_AT"]);
const record = JSON.parse(
  readFileSync("outputs/staging/monitoring-trigger.json", "utf8"),
);
const received = Date.parse(process.env.STAGING_ALERT_RECEIVED_AT);
if (
  !Number.isFinite(received) ||
  received < Date.parse(record.at) ||
  received > Date.now()
)
  throw Error("ALERT_RECEIPT_TIMESTAMP_INVALID");
const evidence = {
  ...record,
  status: "DELIVERY_CONFIRMED_BY_OPERATOR",
  receiptReference: process.env.STAGING_ALERT_DELIVERY_REFERENCE,
  receivedAt: new Date(received).toISOString(),
};
writeFileSync(
  "outputs/staging/monitoring-delivery.json",
  JSON.stringify(evidence, null, 2),
);
writeFileSync(
  "docs/STAGING_MONITORING_EVIDENCE.md",
  `# Staging monitoring evidence\n\nDelivery confirmation supplied by the protected staging operator, after receipt of the real test notification. This is not inferred from SNS API acceptance.\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`,
);
