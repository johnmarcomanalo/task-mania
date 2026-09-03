# Task Mania on Cloudflare

This folder is the Cloudflare build of Task Mania: one Worker that serves the
React UI (built from `../frontend`) and a Hono API mirroring the Laravel one,
on the free plan. Rows live in D1, screenshots and attachments in R2, and
Cloudflare Access handles sign-in — every email that signs in gets a private
board.

```
worker/
  wrangler.jsonc     Worker name, D1 + R2 bindings, static assets, vars
  migrations/        D1 schema; the deploy applies new files automatically
  src/               Hono app (routes/, auth.ts, queries.ts, uploads.ts …)
  test/              vitest on the Workers runtime (local D1 + R2)
```

## Run it locally

```text
npm --prefix worker install            # once
copy worker\.dev.vars.example worker\.dev.vars   # who you are without Access (cmd/PowerShell); `cp` in Git Bash
npm --prefix worker run dev            # builds the UI, migrates local D1, serves http://localhost:8787
```

`npm --prefix worker test` runs the suite; `npm --prefix worker run typecheck` the compiler.

The local Laravel + XAMPP setup in `../backend` keeps working independently
(`php artisan serve` + `npm run dev` in `../frontend`); it has its own data.

## First deploy (once, about 15 minutes)

You need a free Cloudflare account and this repository on GitHub.

1. **Sign in from your PC** — in `worker/`: `npx wrangler login`.
2. **Create the database and the bucket**

   ```bash
   npx wrangler d1 create task-mania
   npx wrangler r2 bucket create task-mania-files
   ```

   Paste the `database_id` the first command prints into `wrangler.jsonc`.
   Commit and push.
3. **Connect the repository** — dashboard → *Workers & Pages* → *Create* →
   *Import a repository* → pick `task-mania`. Settings: root directory
   `worker`, build command `npm run build`, deploy command `npm run deploy`.
   Save and deploy. The first build applies the migrations and publishes
   `https://task-mania.<your-account>.workers.dev`. Every API call answers
   `401` until step 5 — expected.
4. **Turn on Access** — the Worker → *Settings* → *Domains & Routes* →
   `workers.dev` → *Enable Cloudflare Access*. If Zero Trust asks you to pick a
   team name, do; your team domain is `https://<team>.cloudflareaccess.com`.
   Then *Manage Cloudflare Access* → the application → *Policies*: edit the
   policy so **Include = Everyone**, login method **One-time PIN**. On the
   application's overview copy the **Application Audience (AUD) tag**.
5. **Tell the Worker about Access** — put the team domain and the AUD tag into
   `vars` in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), commit,
   push. The push redeploys.
6. Open the URL, type your email, enter the PIN from the mail. Your board is there.

## Day to day

- **Deploy**: push to `main`. Build → migrations → deploy, about two minutes.
- **Logs**: the Worker → *Observability*, or `npx wrangler tail` in `worker/`.
- **Database**: dashboard → *Storage & Databases* → *D1* → `task-mania` →
  *Console* (SQL box), or `npx wrangler d1 execute DB --remote --command "SELECT count(*) FROM tasks"`.
- **Files**: dashboard → *R2* → `task-mania-files`.
- **Who may sign in**: the Access application → *Policies*. Change *Include*
  to a list of emails or an email domain to close the door. The free plan
  covers 50 users a month.
- **Schema change**: add `migrations/0002_<what>.sql`; the next deploy applies it.
- **Time zone**: `APP_TIMEZONE` in `wrangler.jsonc` vars (default `Asia/Manila`) decides which calendar day `captured`/`done_on` and the streak use.
- **Start over**: `npx wrangler d1 execute DB --remote --command "DELETE FROM users"`
  cascades to boards, tasks, files and activity rows. Objects in R2 stay;
  empty the bucket from its page if you want them gone too.

## Free-plan limits

Workers 100k requests/day · D1 5 GB, 5M row reads and 100k row writes/day ·
R2 10 GB · Access 50 users/month. A person, or a small team, stays far below.

## If something is off

- **401 on every request** after Access is on → `ACCESS_TEAM_DOMAIN` /
  `ACCESS_AUD` missing or wrong in `wrangler.jsonc`.
- **"Your session ended"** in the UI → the Access session expired; reload.
  Session length: Zero Trust → *Settings* → *Authentication*.
- **No PIN email** → check spam; allow `notify.cloudflare.com`.
- **Build fails installing the frontend** → `frontend/package-lock.json` must
  be committed (`npm ci` needs it).
- **Zero Trust wants a payment method** — it does that on the free plan for
  some accounts; you are not charged. If you would rather not add one, ask for
  the app-level password fallback instead of Access.
