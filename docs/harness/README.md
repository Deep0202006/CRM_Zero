# ZeroData engineering harness

The harness creates a bounded task capsule, enforces its change boundary, selects affected tests, records raw command evidence outside Git, and produces compact implementation/review handoffs.

## Normal workflow

```sh
npm run harness:new -- --area team-kpi --task "Add weekly KPI comparison without changing daily KPI calculations"
npm run harness:quick
npm run harness:verify
npm run harness:review-pack
npm run harness:release
```

Generated state and evidence live only in `.codex-artifacts/`.

## Area examples

- Team KPI: `--area team-kpi --task "Add weekly comparison without changing daily calculations"`
- Field Visits: `--area field-visits --task "Add a server report outcome filter"`
- Pipeline: `--area pipeline --task "Validate a new lead stage transition"`
- Login UI only: `--area frontend-shell --task "Improve login focus states; UI only"`
- Database: `--area data-platform --task "Add a forward-only RPC migration"`
- Security: `--area authentication --task "Tighten admin route authorization"`
- Cross-device: `--area data-platform --task "Extend the operational bootstrap window"`

Add an area by copying one JSON capsule under `harness/areas/`; scripts discover capsules automatically. Define entrypoints, allowed paths, invariants, tests, docs, and human gates in that one file.

Credential-backed E2E requires `PLAYWRIGHT_USER_EMAIL`, `PLAYWRIGHT_USER_PASSWORD`, `PLAYWRIGHT_ADMIN_EMAIL`, `PLAYWRIGHT_ADMIN_PASSWORD`, and optionally `PLAYWRIGHT_BASE_URL`. Missing credentials are reported as `SKIPPED`.
