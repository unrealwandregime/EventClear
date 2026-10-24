import { assertPrototype } from "./prototype/environment.mjs";
assertPrototype();
await import("./prototype/health.mjs");
await import("./run-remote-staging-lifecycle.mjs");
