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

The plain-language walkthrough of the whole cloud setup — what each product
is, what we clicked, the gotchas, and the limits — is
[`../docs/cloudflare-setup.md`](../docs/cloudflare-setup.md).

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
   Commit and push. If the bucket command fails with code 10042, enable R2
   first: dashboard → *Storage & databases* → *R2* → *Overview* → complete the
   checkout (R2 asks for a payment method; the free allowance still applies).
3. **Connect the repository** — dashboard → *Workers & Pages* → *Create* →
   *Import a repository* → pick `task-mania`. Settings: root directory
   `worker`, build command `npm run build`, deploy command `npm run deploy`.
   Save and deploy. The first build applies the migrations and publishes
   `https://task-mania.<your-account>.workers.dev`. Every API call answers
   `401` until step 5 — expected.
4. **Turn on Access** — the Worker → **Access** tab → *Protect this Worker
   behind Access* → choose **All traffic** (not *Previews only*) → *Apply
   Access*. If Zero Trust asks you to pick a team name, do; your team domain
   is `https://<team>.cloudflareaccess.com`. Then, in Zero Trust:
   - *Integrations → Identity providers → Add an identity provider →
     **One-time PIN*** (without it the login page only offers "Sign in with
     Cloudflare", which admits account members only);
   - *Access controls → Applications → the `task-mania` app → Configure →
     **Login methods***: *Accept all available identity providers* on (or
     One-time PIN only + *Apply instant authentication*);
   - same app → **Policies**: edit the policy so **Include = Everyone**;
   - same app → **Additional settings**: copy the **Application Audience (AUD)
     Tag**.
5. **Tell the Worker about Access** — put the team domain and the AUD tag into
   `vars` in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), commit,
   push. The push redeploys.
6. Open the URL, type your email, enter the PIN from the mail. Your board is there.

## Day to day

- **Deploy**: push to `main`. Build → migrations → deploy, about two minutes.
- **Logs**: the Worker → *Logs*, or `npx wrangler tail` in `worker/`.
- **Database**: dashboard → *Storage & databases* → *D1 SQL database* → `task-mania` →
  *Console* (SQL box), or `npx wrangler d1 execute DB --remote --command "SELECT count(*) FROM tasks"`.
- **Files**: dashboard → *Storage & databases* → *R2* → `task-mania-files`.
- **Who may sign in**: Zero Trust → *Access controls → Applications* → the app
  → *Configure → Policies*. Change *Include* to **Emails** (a list) or **Emails
  ending in** `@yourcompany.com` to close the door. The free plan covers 50
  users a month.
- **Repeat**: open a task → Repeat → Weekly (pick the day) or Monthly (a date,
  or e.g. 2nd Monday); finishing it drops the next copy in To Do with the rule attached.
- **Archive**: tasks done more than 30 days ago leave the board for the Archive
  view; Restore sends one back to To Do.
- **Cancel**: drag a task to the Cancelled column (or Status → Cancelled). It
  is terminal like Done but earns no streak credit; a repeating task skips
  straight to its next copy; archived after 30 days the same as Done.
- **Schema change**: add `migrations/0005_<what>.sql`; the next deploy applies it.
- **Time zone**: `APP_TIMEZONE` in `wrangler.jsonc` vars (default `Asia/Manila`) decides which calendar day `captured`/`done_on` and the streak use. The Done lane's 7-day window and the Overdue/This-week chips use the browser's clock; `done_on`, the archive cutoff and the streak use `APP_TIMEZONE`.
- **Storage limits**: STORAGE_USER_MB / STORAGE_USER_FILES / STORAGE_TOTAL_MB in wrangler.jsonc vars (defaults 300 MB and 500 files per person, 5 GB in total, under the 10 GB R2 free tier). Uploads past a limit answer 422 with the reason; nothing is ever billed by the app itself. Usage per user: GET /api/me → storage.
- **Start over**: `npx wrangler d1 execute DB --remote --command "DELETE FROM users"`
  cascades to boards, tasks, files and activity rows. Objects in R2 stay;
  empty the bucket from its page if you want them gone too.

## Free-plan limits

Workers 100k requests/day · D1 5 GB, 5M row reads and 100k row writes/day ·
R2 10 GB · Access 50 users/month. A person, or a small team, stays far below.

## If something is off

- **401 on every request** after Access is on → `ACCESS_TEAM_DOMAIN` /
  `ACCESS_AUD` missing or wrong in `wrangler.jsonc`.
- **"Your session ended"** in the UI → the Access session (24 h by default)
  expired; reload. Session length: the app → *Configure* (per app) or Zero
  Trust → *Access controls → Access settings* (global).
- **Login page offers only "Sign in with Cloudflare"** → One-time PIN is not
  enabled or not allowed on the app; see step 4.
- **The site loads with no login page** → Access is on *Previews only*; the
  Worker's *Access* tab → *All traffic*.
- **No PIN email** → check spam; allow `notify.cloudflare.com`.
- **Build fails installing the frontend** → `frontend/package-lock.json` must
  be committed (`npm ci` needs it).
- **Zero Trust wants a payment method** — it does that on the free plan for
  some accounts; you are not charged. If you would rather not add one, ask for
  the app-level password fallback instead of Access.
