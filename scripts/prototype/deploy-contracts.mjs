import { stagingCompatibility } from "./environment.mjs";
stagingCompatibility();
await (await import("../aws/deploy-contracts.mjs")).deploy();
