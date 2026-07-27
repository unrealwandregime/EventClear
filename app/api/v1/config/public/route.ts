import { publicJson } from "../../_shared";

export const runtime = "edge";

export function GET() {
  return publicJson({
    mode: "production-readonly",
    chainId: 137,
    mainnetExecution: false,
    dataSource: "live",
    vaultAddress: null,
    fundingPoolAddress: null,
    collateralTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
  });
}
