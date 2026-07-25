# Field Visits Hardening - Release Checklist

## 1. Release Branch
**Branch Name:** `fix/field-visits-production-hardening`

## 2. Production Deployment Procedure
This branch should be merged to the `main` branch. Upon merge, **Vercel auto-deploy on push** will initiate the production build. Ensure Vercel successfully passes the type and lint checks (verified zero critical errors) and promotes the preview deployment to production. 

## 3. Production Migration Command
The administrator MUST run the following exact command against the production Supabase instance to apply the schema migration and avoid production failure:

```bash
npx supabase db push --db-url "postgresql://<user>:<password>@<host>:<port>/<dbname>"
```
*(Alternatively, execute the SQL script natively via the Supabase Dashboard SQL Editor using the file `supabase/migrations/022_field_visits_production_hardening.sql`)*
