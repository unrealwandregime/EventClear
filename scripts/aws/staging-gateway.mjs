import { createServer, request as httpRequest } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { isMain } from "./common.mjs";
export function equal(a, b) {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b ?? "");
  return x.length === y.length && timingSafeEqual(x, y);
}
export function cookie(token, expires) {
  const value = String(expires);
  return `${value}.${createHmac("sha256", token).update(`staging:${value}`).digest("hex")}`;
}
export function authorized(value, token, now = Date.now()) {
  const [expires] = String(value ?? "").split(".");
  const n = Number(expires);
  return (
    Number.isSafeInteger(n) &&
    n > now &&
    n <= now + 3600000 &&
    equal(value, cookie(token, n))
  );
}
export function gateway({ token, apiUrl, webUrl, secure = true }) {
  if (token.length < 32) throw Error("STAGING_ACCESS_TOKEN_REQUIRED");
  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://internal").pathname;
    if (path === "/health") {
      res.end("ok");
      return;
    }
    if (secure && req.headers["x-forwarded-proto"] !== "https") {
      res.writeHead(403);
      res.end("HTTPS_REQUIRED");
      return;
    }
    const authCookie = (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("__Host-staging="))
      ?.slice(15);
    // Machine acceptance uses a header; it never exposes a token to the browser.
    const access =
      authorized(authCookie, token) ||
      equal(req.headers["x-staging-access"], token);
    if (path === "/staging/access" && req.method === "POST") {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const supplied = new URLSearchParams(
        Buffer.concat(chunks).toString(),
      ).get("token");
      if (!equal(supplied, token)) {
        res.writeHead(403);
        res.end("STAGING_ACCESS_REQUIRED");
        return;
      }
      res.writeHead(303, {
        "set-cookie": `__Host-staging=${cookie(token, Date.now() + 3500000)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3500`,
        location: "/app",
        "cache-control": "no-store",
      });
      res.end();
      return;
    }
    if (!access && !["/api/v1/health", "/api/v1/readiness"].includes(path)) {
      res.writeHead(403, {
        "content-type": "text/html",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; form-action 'self'",
      });
      res.end(
        '<!doctype html><title>Controlled EventClear staging</title><h1>Staging access required</h1><form method="post" action="/staging/access"><label>Staging access token <input type="password" name="token" autocomplete="off" required></label><button>Enter staging</button></form>',
      );
      return;
    }
    const target = new URL(req.url, path.startsWith("/api/") ? apiUrl : webUrl);
    const headers = { ...req.headers, host: target.host };
    delete headers["x-staging-access"];
    if (path.startsWith("/api/")) headers["x-staging-access"] = token;
    const upstream = httpRequest(
      target,
      { method: req.method, headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, {
          ...response.headers,
          "cache-control": "no-store",
        });
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("STAGING_UPSTREAM_UNAVAILABLE");
    });
    req.pipe(upstream);
  });
}
if (isMain(import.meta.url)) {
  if (
    process.env.EVENTCLEAR_MODE !== "staging" ||
    process.env.ENABLE_MAINNET_EXECUTION === "true"
  )
    throw Error("STAGING_GATEWAY_MODE_REQUIRED");
  const child = spawn(
    "node",
    ["node_modules/vinext/dist/cli.js", "start", "--port", "3001"],
    { stdio: "inherit", env: process.env },
  );
  child.on("exit", (code) => process.exit(code || 1));
  const server = gateway({
    token: process.env.STAGING_ACCESS_TOKEN ?? "",
    apiUrl: "http://api.eventclear.internal:8000",
    webUrl: "http://localhost:3001",
  });
  server.listen(3000, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      server.close();
      child.kill(signal);
    });
}
