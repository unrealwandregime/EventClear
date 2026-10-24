import { actors } from "./environment.mjs";
console.log(
  JSON.stringify(
    {
      testAssetsOnly: true,
      addresses: {
        ...Object.fromEntries(
          Object.entries(actors()).map(([role, account]) => [
            role,
            account.address,
          ]),
        ),
        admin: process.env.PROTOTYPE_ADMIN_ADDRESS,
      },
      faucetGasRequiredFor: ["deployer", "lp", "tester"],
    },
    null,
    2,
  ),
);
