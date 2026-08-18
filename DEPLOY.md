# Deploying RetailOS for a real test

This guide takes you from **local code on your laptop** to **backend running on a
public URL + a Windows installer you can copy to another PC**. Everything below
uses **free** services.

## The end state

- Backend + Postgres on **Render.com** (free tier)
- Windows installer built with **electron-builder**, one `.exe` file (~150 MB)
- You copy that `.exe` to any Windows PC → double-click → RetailOS installs and
  connects to your hosted backend

Total time end-to-end: about **45 minutes** the first time, then a `git push`
redeploys automatically.

---

## Part 1 — Push the whole repo to GitHub

You push **both** `backend/` and `desktop/` in the same repo. Render builds
the backend from the `backend/` subfolder; you build the installer from
`desktop/` locally.

```bash
cd "C:/Users/singh/Desktop/Retail OS"
git init -b main
git add .
git status                                     # confirm no .env / .venv / *.db
git commit -m "Initial commit: RetailOS"
git remote add origin https://github.com/YOUR_USER/retailos.git
git push -u origin main
```

You'll be prompted for a **Personal Access Token** the first time — create one
at https://github.com/settings/tokens (scope: `repo`).

---

## Part 2 — Deploy the backend to Render

### 2.1  Sign up

Go to https://render.com/ and sign up with GitHub. Free tier is enough.

### 2.2  Create the Postgres database

- Dashboard → **New +** → **PostgreSQL**
- Name: `retailos-db`
- Database: `retailos`
- User: `retailos`
- Region: pick the one nearest you
- Plan: **Free**
- Click **Create Database**

Wait ~2 minutes. When the status turns green, copy the **Internal Database URL**
(starts with `postgres://retailos:...@dpg-...oregon-postgres.render.com/retailos`).
You'll paste it in step 2.4.

> Note: Render's free Postgres expires after 90 days. For anything longer-lived,
> use [Neon](https://neon.tech/) instead — free tier is persistent. The URL
> format is identical; the backend auto-converts it.

### 2.3  Create the web service

- Dashboard → **New +** → **Web Service**
- Connect your GitHub repo (`retailos`)
- Fill in:
  - **Name**: `retailos-backend`
  - **Region**: same as the database above
  - **Branch**: `main`
  - **Root Directory**: `backend`
  - **Runtime**: `Python 3`
  - **Build Command**:
    ```
    pip install -e .
    ```
  - **Start Command**:
    ```
    alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
    ```
  - **Plan**: **Free**

### 2.4  Environment variables

Under **Environment** on the same page, add these:

| Key                | Value                                                                   |
|--------------------|-------------------------------------------------------------------------|
| `ENVIRONMENT`      | `production`                                                            |
| `DEBUG`            | `false`                                                                 |
| `LOG_LEVEL`        | `INFO`                                                                  |
| `SECRET_KEY`       | *(click Generate)* — a random 64+ char string                           |
| `DATABASE_URL`     | The **Internal Database URL** you copied in 2.2                         |
| `CORS_ORIGINS`     | `*` (tighten later when you know the frontend origin)                   |
| `PYTHON_VERSION`   | `3.11`                                                                  |

Click **Create Web Service**. First deploy takes 5–8 minutes.

### 2.5  Verify

When the deploy log shows `Uvicorn running on http://0.0.0.0:10000`, copy your
service URL (looks like `https://retailos-backend.onrender.com`) and open:

- `https://retailos-backend.onrender.com/api/v1/health` → should return `{"status":"ok"}`
- `https://retailos-backend.onrender.com/docs` → the FastAPI Swagger UI

### 2.6  Seed the first admin user

Render → your service → **Shell** tab → run:

```bash
python -m app.cli.seed_admin
```

Follow the prompts (email + password). This is the account you'll log in with.

> **Cold-start warning:** Render's free plan spins the service down after 15 min
> idle. The first request after that takes ~30 s to wake up. Fine for testing,
> not fine for a live counter — upgrade to the $7/mo plan to keep it warm.

---

## Part 3 — Build the Windows installer

Do this on **your dev PC**, not the one you're testing on.

### 3.1  Point the frontend at the hosted backend

Create `desktop/.env.production`:

```
VITE_API_BASE_URL=https://retailos-backend.onrender.com
```

Use the URL from step 2.5. **No trailing slash.**

### 3.2  Install electron-builder

```bash
cd "C:/Users/singh/Desktop/Retail OS/desktop"
npm install
```

`electron-builder` is already in `package.json`; this pulls it in.

### 3.3  Build the installer

```bash
npm run dist:win
```

First build takes 5–10 minutes (Electron downloads the packaged runtime). When
it finishes, look in `desktop/release/`:

```
release/
  RetailOS-Setup-0.1.0.exe        <- give this to your test PC
  win-unpacked/                    <- (portable build, ignore)
```

The `.exe` is a self-contained NSIS installer.

### 3.4  What if the build fails?

- **`sign` errors** — you don't have a Windows code-signing certificate. That's
  fine for personal testing; Windows will show a SmartScreen warning on the
  target PC ("More info" → "Run anyway"). No code changes needed.
- **`pnpm` not found** — the `build` script uses pnpm. Either install pnpm
  globally (`npm i -g pnpm`) or edit `package.json` line 15 to use `npm run`.

---

## Part 4 — Install on the other PC

1. Copy `RetailOS-Setup-0.1.0.exe` to the test PC (USB, Google Drive, whatever).
2. Double-click. If Windows SmartScreen blocks it: **More info** → **Run anyway**.
3. Install to the default location, tick the desktop shortcut.
4. Launch RetailOS. The login screen loads.
5. Sign in with the admin email/password you created in step 2.6.

You're using the same hosted backend from any machine.

---

## Part 5 — Rolling out updates

Because the backend is auto-deployed from `main`:

**Backend change** → `git push` → Render rebuilds and redeploys in ~5 minutes,
zero manual step.

**Frontend change** → `git push` → then on your dev PC:

```bash
cd desktop
npm run dist:win
```

→ copy the new `.exe` to the test PC → reinstall (installer will offer to update).

For self-updating installers (`autoUpdater`), set up a GitHub Release + point
`electron-builder`'s `publish` config at it. Skip for now — manual install is
fine for testing.

---

## Troubleshooting

| Symptom                                               | Fix                                                                                     |
|-------------------------------------------------------|-----------------------------------------------------------------------------------------|
| App on test PC shows "Failed to reach server"         | Wrong `VITE_API_BASE_URL`. Rebuild the installer with the correct URL.                  |
| Render deploy log: `no such column: users.staff_code` | Migration didn't run. Add `alembic upgrade head` to the Start Command (already in 2.3). |
| Login returns 401 immediately                         | You skipped step 2.6 — no admin user exists yet.                                        |
| CORS error in the desktop DevTools console            | `CORS_ORIGINS` on Render doesn't include your Electron origin. Set it to `*` for now.   |
| Backend URL is HTTP not HTTPS                         | Render always gives HTTPS. If you're on your own VPS, put Caddy or nginx in front.      |
| Every request is slow                                 | Free-tier cold start. First request after 15 min idle takes ~30 s. Warm it or upgrade.  |

---

## When you're happy, harden for real production

- Change `CORS_ORIGINS` from `*` to your actual frontend origin(s)
- Add a `TrustedHostMiddleware` allow-list in `app/main.py`
- Set up **daily Postgres backups** (Render → your DB → Backups)
- Wire up **Sentry** for error reporting (10 min: `pip install sentry-sdk`,
  add one call in `main.py`)
- Move `SECRET_KEY` and any real SMTP credentials into Render's env vars,
  never into a committed file
- Upgrade Render to the paid plan so the service doesn't spin down mid-shift
