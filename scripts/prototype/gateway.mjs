import { gateway } from "../aws/staging-gateway.mjs";
if (process.env.EVENTCLEAR_MODE !== "testnet-prototype" || process.env.PROTOTYPE_MAX_MONTHLY_COST_USD !== "0") throw Error("PROTOTYPE_MODE_REQUIRED");
gateway({token:process.env.STAGING_ACCESS_TOKEN ?? "",apiUrl:"http://127.0.0.1:8000",webUrl:"http://127.0.0.1:3000"}).listen(Number(process.env.PORT ?? 10000),"0.0.0.0");
