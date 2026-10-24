import { assertPrototype } from "./prototype/environment.mjs";
assertPrototype();
await import("./run-remote-staging-lifecycle.mjs");
