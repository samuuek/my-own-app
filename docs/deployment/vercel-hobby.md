# Vercel Hobby cloud setup

Setup completed on 2026-08-17. This file intentionally records names and identifiers only; it contains no connection strings, tokens, passwords, or environment values.

## Vercel project

- Team: `765180987zgb-3076s-projects`
- Team ID: `team_Wvaex201KZ5Tx15ncHrWvwsg`
- Verified team plan: `hobby`
- Project: `samuel-workbench`
- Project ID: `prj_hbk0uAt9K2aQzcPuLjVtoXbW6szt`
- Local link: `.vercel/project.json` (ignored by Git)
- Local environment file: `.env.local` (ignored by Git)
- Deployment status: not deployed during resource setup

## Access protection

Vercel Authentication was enabled before any data resource was attached. The verified scope is `prod_deployment_urls_and_all_previews`, so production deployment URLs and every preview require an authorized Vercel session. Git fork protection is also enabled. Password protection was not enabled.

## Free resources

### Neon Postgres

- Resource: `samuel-workbench-db`
- Resource ID: `store_UgPaPd8s7BN6dOb0`
- Provider: Neon
- Installation ID: `icfg_V6DtVrfPKBh59PyDId0qJyTH`
- Status: available and connected to `samuel-workbench`
- Billing plan ID: `free_v3`
- Billing plan name and cost: `Free`
- Payment method required: `false`

### Vercel Blob

- Store: `samuel-workbench-files`
- Store ID: `store_9rQb7o6zZNJO68NR`
- Type: Blob
- Access: `private`
- Region: `iad1`
- Owner: `team_Wvaex201KZ5Tx15ncHrWvwsg`
- Usage: Vercel Blob included with the verified Hobby team limits; stop rather than upgrade if a limit is reached

## Environment key verification

Only key names were inspected. Values were never printed or committed.

| Environment | Required | Present | Missing | Verified keys |
| --- | ---: | ---: | ---: | --- |
| Development | 3 | 3 | 0 | `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `MUZI_RUNTIME` |
| Preview | 3 | 3 | 0 | `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `MUZI_RUNTIME` |
| Production | 3 | 3 | 0 | `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `MUZI_RUNTIME` |

`MUZI_RUNTIME` was added to all three environments through standard input. The development environment was then pulled into the ignored `.env.local` file.

## Migration workflow

Resource setup does not apply a schema or copy desktop data. Use the following gated workflow later:

1. Locate and describe the Vercel-managed Neon project without displaying its connection string.
2. Prepare `database/cloud/001_workspace.sql` on a temporary Neon branch.
3. Verify the temporary branch tables, indexes, and a transaction test.
4. Obtain explicit user approval for the prepared migration ID before applying it to the main branch.
5. Apply the exact prepared migration and verify the main branch.
6. Create and retain a desktop backup, then export only that backup:

```powershell
npm run cloud:export -- --database "$backupPath" --output "$env:TEMP\muzi-cloud-migration-2026-08-16.json"
```

7. Import and verify through the linked Vercel environment, without printing private records or secrets:

```powershell
npx vercel env run -- npm run cloud:import -- --input "$env:TEMP\muzi-cloud-migration-2026-08-16.json"
npx vercel env run -- npm run cloud:verify -- --input "$env:TEMP\muzi-cloud-migration-2026-08-16.json"
```

Run import and verification twice to prove idempotency. Promote a deployment only after counts and the canonical hash match.

## Rollback procedure

1. If temporary-branch schema verification fails, discard the prepared Neon migration instead of applying it to the main branch.
2. If data import or hash verification fails, do not deploy or promote the cloud application. Keep using the unchanged desktop application and retained local backup.
3. Preserve the Neon resource for investigation; do not delete cloud or local data until the retained backup and verification output have been checked.
4. If a later preview deployment fails, leave production unchanged. If a promoted deployment fails, use Vercel's deployment rollback to point production back to the last verified deployment.
5. Do not accept a paid upgrade, trial, payment-method request, domain purchase, metered add-on, or nonzero charge as part of rollback or recovery.
