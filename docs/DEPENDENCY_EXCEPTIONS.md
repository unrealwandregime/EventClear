# Dependency security exceptions

Production dependencies fail CI for every high or critical advisory. Critical
advisories fail regardless of dependency scope. Development-only high
advisories require a time-bounded entry in
`config/security/dependency-exceptions.json`; expired or unlisted findings fail
the build.

## Active exception

`GHSA-mh99-v99m-4gvg` affects the transitive `brace-expansion` package used by
ESLint tooling. Package: `brace-expansion` 1.1.16. Dependency type:
development-only transitive dependency. Affected execution path:
`eslint → minimatch → brace-expansion`; it is not part of the production bundle
or runtime container. Temporary acceptance is limited to local/CI linting.
Mitigation: lint only trusted repository patterns in isolated CI and upgrade
the ESLint dependency graph as soon as a compatible patched release exists.
Owner: protocol engineering. Expiration: 2026-08-31.

The license gate rejects AGPL, GPL, SSPL, BUSL and Commons Clause dependency
licenses. Any policy change requires an explicit legal review and a committed
policy update.
