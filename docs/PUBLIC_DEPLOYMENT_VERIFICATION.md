# Public deployment verification

- Public URL: `https://eventclear-protocol.thecryptotom.chatgpt.site/`
- Sites version: `13`
- Deployment source commit:
  `876743d7177dfcf2f226c9c12b189bfcf50822ec`
- Deployment status: `succeeded`
- Verification time: `2026-07-28T16:15:20Z`
- Access mode: public
- Hosted environment revision: `0`; no staging variables are present

## Anonymous cache-bypassing results

Each request used a unique `cacheBust` query and `Cache-Control: no-cache`.

| Request | Result |
| --- | --- |
| `GET /` | HTTP 200 |
| `GET /api/v1/config/public` | HTTP 200; `mainnetExecution=false`; `publicCapitalActivated=false` |
| `GET /api/v1/protocol/metrics` | HTTP 200; unavailable indexed production state, no fake metrics |
| `POST /api/v1/quotes` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/analyze` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/open/prepare` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/1/prepare-settlement` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/claims/1/prepare-redemption` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/pool/prepare-deposit` | HTTP 403 `PRODUCTION_READONLY` |

A clean in-app browser session observed two visible `Public read-only alpha`
labels and one visible
`Standard binary markets only · public capital execution disabled · No public capital activated`
status. `Mainnet candidate`, `Mainnet release candidate`, and `EC-00418` were
absent from anonymous responses.

## Cache and route ownership

Version 10 was sourced from pre-merge commit `1e1c2f3…`; the Sites source branch
was aligned first to baseline merge `595be49…`, then to the final default-branch
merge above. Version 13 now owns the Sites hostname. Cache-bypassing requests
returned the refreshed configuration and explicit nested write guards. No
service worker is registered by the application; the homepage responded with
`no-store, must-revalidate`, while public JSON uses a bounded 15-second cache
with 45-second stale revalidation.
