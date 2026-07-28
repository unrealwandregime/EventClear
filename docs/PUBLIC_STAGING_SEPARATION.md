# Public and staging separation

## Public production-readonly

- Host: `https://eventclear-protocol.thecryptotom.chatgpt.site/`
- Mode: `production-readonly`; chain ID 137 only for public Polymarket reads.
- `mainnetExecution=false` and `publicCapitalActivated=false`.
- All unmatched POST, PUT, PATCH and DELETE API routes return HTTP 403 with
  `PRODUCTION_READONLY`.
- No staging RPC, contract manifest, API URL, signer, tester allowlist or
  staging metrics is stored in the Sites environment.

## Controlled staging

- Status: **NOT DEPLOYED**
- Must use `EVENTCLEAR_MODE=staging`, PostgreSQL, authenticated Redis, private
  immutable S3 artifacts, two RPC URLs, KMS signing, tester/admin/LP allowlists,
  a non-137 chain and a real access-control layer.
- The staging frontend and API will use dedicated DNS and TLS endpoints and
  must never replace or proxy the public Sites API.

Automated configuration rejection is implemented. Remote authorization and
negative tests remain unverified until the external credential boundary is
removed.
