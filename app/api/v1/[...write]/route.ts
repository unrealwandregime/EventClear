import { publicJson } from "../_shared";

export const runtime = "edge";

const productionReadonly = () =>
  publicJson(
    {
      detail: {
        code: "PRODUCTION_READONLY",
        message: "Execution and capital writes are disabled on the public deployment.",
      },
    },
    403,
  );

export const POST = productionReadonly;
export const PUT = productionReadonly;
export const PATCH = productionReadonly;
export const DELETE = productionReadonly;
