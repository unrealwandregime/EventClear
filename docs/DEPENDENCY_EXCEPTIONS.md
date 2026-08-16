# Dependency security exceptions

Production dependencies fail CI for every high or critical advisory. Critical
advisories fail regardless of dependency scope. Development-only high
advisories require a time-bounded entry in
`config/security/dependency-exceptions.json`; expired or unlisted findings fail
the build.

## Active exceptions

Two development-only `image-size` advisories (`GHSA-w3rx-r6r6-pgpr` and
`GHSA-5p2g-fcmc-qvqq`) are temporarily accepted until 2026-09-15. The package
is used only by the vinext build tool and is absent from the production worker;
builds process only trusted checked-in images. Both advisories name 2.0.3 as
patched, but the registry currently publishes only through 2.0.2. Remove both
exceptions immediately when 2.0.3 is published.

All other current high-severity transitive findings are patched through
workspace overrides. The former `brace-expansion` exception was removed on
2026-08-16.

The license gate rejects AGPL, GPL, SSPL, BUSL and Commons Clause dependency
licenses. Any policy change requires an explicit legal review and a committed
policy update.
