# Task Mania on Cloudflare — the plain-language guide

This is the "come back to it later" guide for how Task Mania runs on Cloudflare,
what we clicked to get there, and how to look after it. Every dashboard path and
limit below was checked against Cloudflare's official docs on 2026-09-04 (links
at the end). Menus move; if a path no longer matches, the docs links are the
source of truth.

---

## 1. The big picture

```
your browser
   │
   ▼
Cloudflare Access  ── "Who are you?" (email + PIN). Blocks everyone else.
   │
   ▼
Worker  task-mania  ── one small program running on Cloudflare's servers
   ├── serves the React app (the built files from frontend/)
   ├── answers /api/...   (the same API Laravel used to answer)
   ├── reads/writes rows in  D1  (a SQLite database in the cloud)
   └── reads/writes files in  R2  (screenshots, attachments)
```

| Cloudflare product | What it is, in plain words | Ours |
|---|---|---|
| **Worker** | A program that runs on Cloudflare's edge servers whenever someone hits your URL. Ours is written in TypeScript (`worker/src`). It replaces Laravel + Apache. | `task-mania` |
| **Static assets** | The built React files (`frontend/dist`) uploaded together with the Worker. | served from `/` |
| **D1** | Cloudflare's SQLite database. Same tables as the Laravel MySQL schema. | `task-mania` |
| **R2** | File storage (like AWS S3). Screenshots and attachments live here. | bucket `task-mania-files` |
| **Access** (part of **Zero Trust**) | A login wall in front of the URL. It emails a one-time PIN, then tells the Worker *who* signed in. | app `task-mania - Cloudflare Workers` |
| **Workers Builds** | Cloudflare's CI: watches the GitHub repo, builds and deploys on every push to `main`. | connected to `johnmarcomanalo/task-mania` |
| **wrangler** | Cloudflare's command-line tool (`npx wrangler …`). Used once for setup; Builds uses it on every deploy. | version 4.x in `worker/` |

**Each email that signs in gets its own private board.** The Worker creates the
user and the board the first time it sees that email.

The local XAMPP setup (`backend/` + `frontend/`) still works on its own with its
own MySQL data. The cloud has separate data.

---

## 2. Our account facts (not secrets)

| Thing | Value | Where it lives |
|---|---|---|
| Live URL | https://task-mania.johnmarcomanalo09.workers.dev | Worker → Overview |
| Cloudflare account | johnmarcomanalo09@gmail.com's Account, id `99c9de8b…09cb7` | dashboard, top-right |
| GitHub repo | github.com/johnmarcomanalo/task-mania (branch `main`) | Worker → Settings → Build |
| D1 database | `task-mania`, id `1bb12d1c-9fd9-4f66-89c0-1d8633fa10de` | `worker/wrangler.jsonc` |
| R2 bucket | `task-mania-files` | `worker/wrangler.jsonc` |
| Zero Trust team domain | https://weathered-rain-8654.cloudflareaccess.com | `wrangler.jsonc` → `ACCESS_TEAM_DOMAIN` |
| Access app AUD tag | `b266dac0…843c` (public identifier of the Access app) | `wrangler.jsonc` → `ACCESS_AUD` |
| Time zone for dates | `Asia/Manila` | `wrangler.jsonc` → `APP_TIMEZONE` |

The AUD tag and team domain are how the Worker double-checks the login token
Access sends it. If they are wrong, **every** API call answers `401 Not signed in`.

---

## 3. What happens when you push

```
git push origin main
   → Workers Builds clones the repo
   → runs  npm run build   in worker/     (installs + builds ../frontend with VITE_API_URL=/api)
   → runs  npm run deploy  in worker/     (wrangler d1 migrations apply DB --remote, then wrangler deploy)
   → new version is live in ~2–3 minutes
```

Watch it: **Workers & Pages → task-mania → Deployments** (and the *Builds* list
there). A red build means the deploy did not happen; the old version stays live.

The settings that make this work (**Workers & Pages → task-mania → Settings →
Build**):

| Setting | Value | Why |
|---|---|---|
| Git repository / branch | `johnmarcomanalo/task-mania` / `main` | what to watch |
| **Root directory** | `worker` | the build runs *inside* `worker/` — this was the first build failure (it ran at the repo root, found no `package.json`) |
| Build command | `npm run build` | see `worker/package.json` |
| Deploy command | `npm run deploy` | migrations, then deploy |

---

## 4. The one-time setup, as we actually did it

You do not need to repeat this. It is here so the sequence makes sense if you
ever set up a second copy (a staging app, a fresh account…).

### 4.1 Push the code to GitHub
Workers Builds needs the repo on GitHub. Gotcha we hit: the PC had a stored
GitHub token for a *different* account (`aim-mis`), so the push was denied
(403). Fix: remove the stale entry from Git Credential Manager
(`git credential-manager erase` with `username=x-access-token`), push again,
sign in as the right account when the browser opens.

### 4.2 Sign wrangler in, create the database and the bucket
In `worker/`:

```bash
npx wrangler login                          # opens the browser, click Allow
npx wrangler d1 create task-mania           # prints the database_id → paste into wrangler.jsonc
npx wrangler r2 bucket create task-mania-files
```

Gotcha: `r2 bucket create` fails with *"Please enable R2 through the Cloudflare
Dashboard" (code 10042)* until R2 is enabled. Enable it at **Storage &
databases → R2 → Overview** and complete the checkout flow (R2 asks for a
payment method; the free allowance still applies and nothing is charged inside
it — see §7).

### 4.3 Connect the repo (Workers Builds)
**Workers & Pages → Create application → Import a repository → Get started** →
pick the Git account and the repo → set **Root directory = `worker`**, build
`npm run build`, deploy `npm run deploy` → **Save and Deploy**.

The first successful build creates the Worker and applies the D1 migration.
At this point the site loads but every API call is `401` — expected, Access is
not on yet and the Worker refuses anything without a valid login token.

### 4.4 Put Access in front of it
**Workers & Pages → task-mania → Access tab → Protect this Worker behind Access
→ choose "All traffic" (not "Previews only") → Apply Access.**

Gotchas we hit, in order:
1. The older path *Settings → Domains & Routes → Enable Cloudflare Access* no
   longer exists; the Worker has its own **Access** tab now.
2. We first got *"Previews only"*: the site loaded with no login and the Zero
   Trust app's destination said *"A Worker's preview URLs"*. Switching the
   Worker's Access tab to **All traffic** fixed it (you never type a hostname).
3. The auto-created app only offered **"Sign in with Cloudflare"** and said
   *"restricted to members of the account"* — only members of *your* Cloudflare
   account could get in. Fix in Zero Trust:
   - **Integrations → Identity providers → Add an identity provider → One-time PIN**
   - **Access controls → Applications → task-mania - Cloudflare Workers → Configure
     → Login methods**: *Accept all available identity providers* ON (or pick
     One-time PIN only and turn on *Apply instant authentication* so users go
     straight to the email box)
   - **Policies**: edit the policy so **Include = Everyone**

### 4.5 Tell the Worker about the Access app
Copy two values into `worker/wrangler.jsonc` → `vars`, commit, push:

- **Team domain**: `https://<team>.cloudflareaccess.com` — the team name you
  chose when Zero Trust was set up (visible in the login page URL).
- **AUD tag**: **Zero Trust → Access controls → Applications → Configure →
  Additional settings → Application Audience (AUD) Tag**. (It is *not* on the
  *Application details* tab — that cost us a few minutes.)

How to check without the dashboard: `curl -sI https://task-mania.…workers.dev/`
must answer `302` to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/…?kid=<AUD>`.
The `kid` in that URL **is** the AUD tag, and the host is the team domain.

---

## 5. Day-to-day

| I want to… | Do this |
|---|---|
| Open the app | https://task-mania.johnmarcomanalo09.workers.dev → email → PIN from the email (check spam; sender is `notify.cloudflare.com`) |
| Log out | the **Log out** link in the header (it goes to `/cdn-cgi/access/logout`) |
| Make a task repeat | open it → Repeat → Weekly (pick the day) or Monthly (a date, or e.g. 2nd Monday); the next copy appears in To Do when you finish it |
| Cancel a task | drag it to the Cancelled column (or Status → Cancelled); archived after 30 days like Done; a repeating task skips straight to its next copy |
| Find old finished tasks | Archive view (tasks done > 30 days ago); Restore sends them back to To Do |
| Read the log | Log view: every line names its task (click to open) and edits show old → new; grouped by day, with a search box |
| Deploy a change | `git push origin main` — nothing else |
| See errors / logs | **Workers & Pages → task-mania → Logs** (or, in `worker/`: `npx wrangler tail`) |
| Look at the data | **Storage & databases → D1 SQL database → task-mania → Console** (type SQL). Or `npx wrangler d1 execute DB --remote --command "SELECT email, last_seen_at FROM users"` |
| Look at the files | **Storage & databases → R2 → Overview → task-mania-files** |
| Let only certain people in | **Zero Trust → Access controls → Applications → task-mania… → Configure → Policies** → edit the policy: *Include* = **Emails** (a list) or **Emails ending in** `@arvinintl.com` instead of *Everyone* |
| Change how long a login lasts | same app → *Configure* → session duration (default **24 hours**); global default at **Zero Trust → Access controls → Access settings** |
| Add Google sign-in | **Zero Trust → Integrations → Identity providers → Add → Google** (needs a Google Cloud OAuth client), then enable it under the app's *Login methods* |
| Change the schema | add `worker/migrations/0004_<what>.sql`; the next push applies it (`d1 migrations apply --remote` runs before `wrangler deploy`) |
| Change the date time zone | `APP_TIMEZONE` in `wrangler.jsonc`, then push |
| Change the upload limits | STORAGE_* vars in wrangler.jsonc, then push |
| Wipe everything | `npx wrangler d1 execute DB --remote --command "DELETE FROM users"` (cascades to boards, tasks, files, activity). R2 objects stay — empty the bucket from its page if wanted |
| Turn Access off for everyone (danger) | the Worker's **Access** tab. Do not: the API then answers 401 for everybody anyway, but the static UI becomes public |

---

## 6. Running it on your PC (no cloud needed)

```bash
npm --prefix worker install                      # once
copy worker\.dev.vars.example worker\.dev.vars   # Git Bash: cp …
```

Put any email in `worker/.dev.vars` (`ACCESS_DEV_EMAIL=you@example.com`) — that
is "who you are" locally, since there is no Access in front of `wrangler dev`.
It only works for `localhost`/`127.0.0.1` and is never uploaded (the file is
git-ignored).

```bash
npm --prefix worker run dev      # builds the UI, migrates the local D1, serves http://localhost:8787
npm --prefix worker test         # 78 tests on a local copy of the Workers runtime
npm --prefix worker run typecheck
```

The local D1/R2 live under `worker/.wrangler/` (git-ignored). Delete that
folder to start over locally.

---

## 7. Free-plan limits (checked 2026-09-04)

| Product | Free allowance | What happens past it |
|---|---|---|
| Workers | 100,000 requests/day; 10 ms CPU per request; static assets up to 20,000 files, 25 MiB each | requests are refused until the next day (UTC) |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total | queries stop until the next day; storage needs deleting or a paid plan |
| R2 | 10 GB-month storage, 1 M Class A (write) and 10 M Class B (read) operations/month, **egress free** | standard pricing applies beyond that; a payment method is on file because R2 required it — the app refuses uploads past 300 MB/500 files per person and 5 GB in total, so the free tier cannot be exceeded by uploads |
| Access / Zero Trust | 50 users per month | new sign-ins are refused until the plan is upgraded ($7/user/month) |
| Workers Builds | included; builds run one at a time | — |

One person, or a small team, stays far inside all of these. A board view with
many screenshots costs roughly one D1 read per row plus one R2 read per image.

---

## 8. If something is off

| Symptom | Likely cause → fix |
|---|---|
| Login page shows only *"Sign in with Cloudflare"* / *restricted to members* | One-time PIN not enabled or not allowed on the app → §4.4 step 3 |
| Site loads with **no** login page | Access is on *Previews only* → Worker → Access tab → All traffic |
| After the PIN, the app says **"Not signed in"** on everything | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` wrong or the build with them not deployed yet → check `wrangler.jsonc` vars vs §4.5, check Deployments |
| **"Your session ended — reload"** in the UI | the Access session (24 h) expired mid-use → reload, sign in again |
| PIN email never arrives | spam folder; corporate filter → allow `notify.cloudflare.com` |
| Build fails: *Could not read package.json at /opt/buildhome/repo* | Root directory is not `worker` → Settings → Build |
| Build fails at `npm ci` for the frontend | `frontend/package-lock.json` not committed |
| `wrangler r2 bucket create` → code 10042 | R2 not enabled → Storage & databases → R2 → Overview |
| `git push` → 403 *denied to <other account>* | stale GitHub token in Git Credential Manager → §4.1 |
| Someone sees another person's screenshot URL | they can't: `/storage/*` checks the owner and answers 404 — if you ever see otherwise, report it |

---

## 9. Words

- **Worker** — Cloudflare's name for a small server-side program. Ours is the whole backend.
- **wrangler** — the CLI for Workers, D1, R2. `npx wrangler <command>` inside `worker/`.
- **wrangler.jsonc** — the Worker's config: name, bindings (DB, FILES), vars, where the static files are.
- **Binding** — a name the code uses (`DB`, `FILES`) that Cloudflare connects to the real database/bucket.
- **D1** — SQLite in the cloud. **Migration** — a numbered `.sql` file in `worker/migrations/` that changes the schema once.
- **R2** — object storage; every file is a **key** like `screenshots/<uuid>.png` plus bytes and metadata.
- **Zero Trust** — Cloudflare's security product family. **Access** is the login-wall part of it.
- **Team domain** — `https://<team>.cloudflareaccess.com`, where Access shows the login page.
- **Access application** — the Zero Trust object that says "this URL is protected, by this policy, with these login methods".
- **Policy** — who is allowed: *Include* rules (Everyone / Emails / Emails ending in …), *Exclude*, *Require*.
- **Identity provider / login method** — how people prove who they are: One-time PIN (email code), Google, Cloudflare account, …
- **AUD tag** — the Access application's public id. Access stamps it into the login token; the Worker checks it.
- **JWT** — the signed login token Access adds to each request (`Cf-Access-Jwt-Assertion` header). The Worker verifies the signature, the team domain and the AUD, then reads the email from it.
- **Workers Builds** — Cloudflare's build-and-deploy-on-push service for Workers.

---

## 10. Verified against (official docs, 2026-09-04)

- Enable Access on a Worker (Access tab, Previews only / All traffic, Protect all Workers): developers.cloudflare.com/workers/configuration/cloudflare-access/
- AUD tag location (Applications → Configure → Additional settings): developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
- One-time PIN setup (Integrations → Identity providers): developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- Policies (Include/Exclude/Require; Everyone, Emails, Emails ending in): developers.cloudflare.com/cloudflare-one/access-controls/policies/
- Session duration and logout URLs: developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/
- Workers Builds settings (root directory, build/deploy command): developers.cloudflare.com/workers/ci-cd/builds/configuration/ and …/workers/ci-cd/builds/
- D1 create/execute and the dashboard Console: developers.cloudflare.com/d1/get-started/
- R2 subscription requirement and dashboard path: developers.cloudflare.com/r2/get-started/
- Limits: developers.cloudflare.com/workers/platform/limits/ · …/d1/platform/pricing/ · …/r2/pricing/
- Zero Trust free plan (50 users): cloudflare.com/plans/zero-trust-services/

Engineering details (routes, schema, tests, design decisions) are in
`docs/superpowers/specs/2026-09-03-cloudflare-deployment-design.md`; the
operator quick-reference is `worker/README.md`.
