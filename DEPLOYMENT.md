# Deployment — RetailOS

Operational reference for installing, updating and supporting RetailOS at a
client site.

> Setting up from a completely empty machine for the first time? Start with
> **[DEPLOY.md](DEPLOY.md)**, then come back here.

---

## Overview

Two pieces are deployed separately:

| Piece | Where it runs | How it ships |
|---|---|---|
| **Backend** | A server (Render, a VPS, or a PC in the shop) | Git push / Docker |
| **Desktop app** | Each till | A Windows `.exe` installer |

Tills talk to the backend over HTTPS. **They keep selling when it is
unreachable** and sync when it returns.

---

## Part 1 — Backend

### 1.1 Required configuration

Copy `backend/.env.example` to `backend/.env` and set these. The first two are
not optional.

| Variable | Notes |
|---|---|
| `ENVIRONMENT` | `production` |
| `SECRET_KEY` | **Generate a real one.** See below |
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@host:5432/retailos` |
| `CORS_ORIGINS` | Explicit list. Never `*` in production |
| `ALLOWED_HOSTS` | Your API hostname(s) |

Generate the signing key:

```bash
openssl rand -hex 32
```

> **The app will refuse to start** in production if `SECRET_KEY` is missing,
> short, or still looks like a placeholder. That is intentional. This key signs
> every login token — the default is published in this repository, so leaving it
> would let anyone mint a valid token for any user and act as the owner. A
> server that will not start gets fixed in minutes; one running on a public key
> is discovered much later and much worse.
>
> Copying `.env.example` verbatim will also be rejected. Generate a fresh key.

### 1.2 Migrate

```bash
cd backend && alembic upgrade head
```

Run this on **every** deploy, before or immediately after the new code starts.
Current head is `20261222_0021_bill_mrp_and_message`.

### 1.3 Verify

```bash
curl https://your-api/api/v1/health
```

Then confirm the hardening actually applied:

- `https://your-api/docs` returns **404** — API docs are off in production.
- Logs contain no `cors_wildcard_in_production` or
  `trusted_host_wildcard_in_production` warnings.

### 1.4 Deploying to Render

Root directory `backend/`, build `pip install -e .`, start
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set every variable from
§1.1 in the dashboard.

> **Known open item.** As of this writing Render has not deployed since commit
> `56b08db`. Migrations `0015`–`0021` are **not applied** there, so returns,
> price lists, credit limits, unit conversions, bundles, bill MRP, the password
> gate and loyalty are all absent from the hosted API. Check the service's
> auto-deploy setting and its most recent build log before assuming a push is
> live.

---

## Part 2 — Building the Windows installer

### 2.1 One-time machine setup

**Enable Developer Mode** — Settings → System → For developers → Developer Mode
→ **On**.

This is required, and the reason is not obvious. `electron-builder` downloads a
code-signing toolchain whose archive contains macOS symlinks. Creating a symlink
on Windows needs a privilege a standard account lacks, so extraction fails with:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
    …winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

The build then fails, and the error names macOS files a Windows build never
uses, which sends people looking in the wrong place. Running the build from an
**Administrator terminal** works equally well. Pre-extracting the cache does
*not* help — a fresh randomly-named temp directory is used every attempt.

### 2.2 Build

```bash
cd desktop
npm ci
npm test                    # 446 tests — do not skip
npm run dist:win
```

Output: `desktop/release/RetailOS-Setup-<version>.exe`

### 2.3 What you should see

| Artefact | Expected |
|---|---|
| `release/RetailOS-Setup-*.exe` | The installer |
| `release/win-unpacked/RetailOS.exe` | ~189 MB |
| `release/win-unpacked/resources/app.asar` | ~26 MB |
| `…/app.asar.unpacked/…/better_sqlite3.node` | **Must be present** |

That last one matters: a native module cannot load from inside an asar. If it
is missing, the app will start and then fail to open its database.

### 2.4 Support builds

Production builds ship **without source maps**, so the client does not receive
the application's complete source. To build a diagnosable version:

```bash
RETAILOS_SOURCEMAP=1 npm run build && npx electron-builder --win --publish never
```

---

## Part 3 — Installing at the shop

1. Copy the `.exe` to the till.
2. Run it. **Windows SmartScreen will warn** — the app is not code-signed.
   Choose *More info* → *Run anyway*. Tell the client to expect this, or they
   will reasonably assume the software is malware.
3. Choose an install directory; the installer creates desktop and Start Menu
   shortcuts.
4. Launch, sign in, and set the backend URL if it is not baked in.

### Where data lives

```
%APPDATA%\RetailOS\
  retailos.db              Local database (WAL mode)
  retailos.db-wal / -shm   WAL sidecars — never delete separately
  backups\                 Automatic timestamped copies + JSON manifests
  retailos-credentials.enc "Remember me", encrypted by Windows DPAPI
```

Back up the **whole folder**, and only while the app is closed. Copying
`retailos.db` without its `-wal` file can lose the most recent transactions.

---

## Part 4 — Updating a till

1. Confirm the backend is migrated **first**. A newer app against an older API
   will fail on endpoints that do not exist yet.
2. Close RetailOS on the till. Confirm no `RetailOS.exe` remains in Task
   Manager — the running app holds a lock on the database file.
3. Run the new installer over the old one. Local data is preserved; schema
   migrations run automatically at startup.
4. Sign in and check **Sync status** shows no stuck queue.

> **Never update a till with unsynced offline sales.** Check the sync screen
> first. The data is not lost by updating, but resolving a queue is far easier
> before the version changes underneath it.

---

## Part 5 — Verifying a deployment

Run through this at the shop before leaving.

**Online**
- [ ] Sign in
- [ ] Ring up a cash sale; the receipt prints with shop name, address **and
      GSTIN**
- [ ] The bill appears in Sales, and in the backend
- [ ] Stock decreased by the right quantity

**Offline** — disconnect the network
- [ ] Ring up a sale; it completes and prints
- [ ] Reconnect; the sale syncs within a minute
- [ ] The server shows it **once**, not twice
- [ ] Totals on paper, in the app, and on the server match exactly

**Restart while offline**
- [ ] Ring up a sale offline, close the app, reopen it still offline
- [ ] The sale is still there
- [ ] Reconnect; it syncs

**Safety**
- [ ] Deleting a product asks for a password
- [ ] A wrong password is refused
- [ ] A day session opens and closes with correct cash reconciliation

---

## Part 6 — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Installer build fails on `libcrypto.dylib` | Symlink privilege | Developer Mode or admin terminal (§2.1) |
| `NODE_MODULE_VERSION` error in tests | Native module built for Electron | Use `npm test`, not `npx vitest` |
| `npm test` fails to rebuild, `EBUSY` | The app is open and locking the file | Close RetailOS, retry |
| App starts, database unavailable | `better_sqlite3.node` inside the asar | Check `asarUnpack` (§2.3) |
| Backend exits with `SECRET_KEY … placeholder` | Working as designed | Generate a real key (§1.1) |
| Sales stuck "pending" | Wrong API URL, or backend not migrated | Check the URL; `alembic upgrade head` |
| Endpoint 404s from the app but works locally | Backend not deployed | See §1.4 |
| SmartScreen blocks the installer | Not code-signed | *More info* → *Run anyway*, or buy a certificate |

### Reading the logs

The main process logs structured JSON. Security events are prefixed
`security.` — for example `security.blocked_navigation`, which records a URL
scheme the app refused to hand to the operating system.

---

## Part 7 — Before wider distribution

Fine for a pilot with a known client. Address these before shipping to
customers you do not know:

1. **Buy a code-signing certificate** (OV or EV). Without one, every customer
   meets a SmartScreen warning, and some antivirus products will quarantine the
   installer outright.
2. **Set up automatic updates.** There is no update channel today; every update
   is a manual visit to each till.
3. **Test on a real thermal printer.** Receipt layout is unit-tested but
   `physicalHardwareVerified` is `false` and that is accurate — no physical
   printer has ever been used.
4. **Load-test multi-terminal operation.** Row locking is correct by design and
   unit-tested, but concurrent behaviour has not been measured.

See **[PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md)** §6 and §7 for the full list.
