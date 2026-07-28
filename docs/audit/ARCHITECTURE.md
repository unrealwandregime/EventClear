# Architecture

The web obtains public market data and, only in controlled environments, a
SIWE-bound API session. The API loads reviewed relationships, reproduces solver
artifacts, performs live pre-sign checks, and signs bounded quotes. The
non-upgradeable vault escrows exact ERC-1155 legs, the pool advances pUSD, and
principal/residual ERC-1155 claims encode settlement priority. The indexer
projects canonical events into PostgreSQL and reconciles reorgs and balances.

Public production-readonly and execution-enabled staging are separate trust
boundaries; the public deployment never receives staging URLs or secrets.
