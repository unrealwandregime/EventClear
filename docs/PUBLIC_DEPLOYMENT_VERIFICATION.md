# Public deployment verification

- Public URL: `https://eventclear-protocol.thecryptotom.chatgpt.site/`
- Sites version: `16`
- Deployment source commit:
  `01daf89781dbd7de4f60db054585617a7315e1c2`
- Deployment status: `succeeded`
- Verification time: `2026-09-05T07:35:35Z`
- Access mode: public
- Hosted environment revision: `0`; no staging variables are present

## Anonymous cache-bypassing results

Each request used a unique `cacheBust` query and `Cache-Control: no-cache`.

| Request | Result |
| --- | --- |
| `GET /` | HTTP 200; investor homepage with the live research demo and scanner |
| `GET /app` | HTTP 200; research-stage protocol interface |
| `GET /api/v1/config/public` | HTTP 200; `mainnetExecution=false`; `publicCapitalActivated=false` |
| `GET /api/v1/markets` | HTTP 200; 100 current markets from `polymarket-gamma-live` |
| `GET /api/v1/claims` | HTTP 200; empty verified indexed state |
| `GET /api/v1/protocol/metrics` | HTTP 200; unavailable indexed production state, no fake metrics |
| `GET /robots.txt` | HTTP 200; public crawler access allowed |
| `GET /sitemap.xml` | HTTP 200; public homepage and protocol interface listed |
| `GET /og-research.png` | HTTP 200; 1,278,591-byte release social card |
| `POST /api/v1/quotes` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/analyze` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/open/preflight` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/open/prepare` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/bundles/1/prepare-settlement` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/claims/1/prepare-redemption` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/pool/prepare-deposit` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/pool/prepare-withdrawal` | HTTP 403 `PRODUCTION_READONLY` |
| `POST /api/v1/admin/relationships` | HTTP 403 `PRODUCTION_READONLY` |

The anonymous server-rendered homepage contained the investor narrative,
canonical proof example, live scanner, interactive proof calculator, protocol
architecture, progress, and fundraising sections. It did not contain
`API_405`, `Unavailable`, or `No verified active bundle`. The live configuration
remained production-readonly with public capital disabled. No authenticated
request headers or Sites bypass token were used for the checks.

## Cache and route ownership

Version 14 introduced the zero-cost public research release from merge commit
`e86fe6e…`. Anonymous verification found that the upstream Gamma markets
endpoint rejected the documented snake_case sort field. PR #6 corrected the
adapter to the accepted `volume24hr` field, all seven CI jobs passed again, and
version 15 was published from that exact default-branch merge. Version 16 adds
the investor-facing public homepage, moves the technical protocol interface to
`/app`, provides the missing claims read endpoint, and publishes crawler metadata.
It was deployed from PR #8's exact default-branch merge after all seven CI jobs,
including the Polygon fork suite, passed. Version 16 now owns the Sites hostname.
Public JSON uses a bounded 15-second cache with 45-second stale revalidation.
