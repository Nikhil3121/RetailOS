# RetailOS — JR Retail OS

An **offline-first** point-of-sale and inventory system for textile and garment
retail, built for M.S. Mall (Madanpur) and its two branches.

The whole design turns on one rule: **the till keeps working when the network
does not.** A sale is committed to local storage before any network call is
attempted, and the money on the printed receipt, the money in the local
database, and the money in the server database are the same number — always.

```
RECEIPT  ==  SQLITE  ==  POSTGRESQL
```

---

## What it does

**Billing** — barcode scanning, split payments, credit sales, returns and
credit notes, one-action exchanges, advances, per-customer price lists, product
bundles, bill-level discounts and coupons, loyalty points spendable at the
till, gift schemes on bill value. Held bills are shared across the counters of
a branch, so a customer who steps away at one till can be finished at the
other. Every invoice copy after the first is marked DUPLICATE.

**Inventory** — variants (size × colour), stock movements with a full audit
trail, purchase orders with goods receipt and last-purchase-rate lookup, unit
conversion (buy in cartons, stock in pieces), reorder points, transfers between
branches, and physical stock audit: blind count sheets that post the variance
found rather than the total counted, so a count taken during trading hours does
not undo the evening's sales.

**Money and compliance** — GST-compliant invoices with separate serial series
per document type (`INV-` / `CRN-` / `ADV-`), CGST/SGST split, HSN codes,
per-branch GSTIN, day sessions with cash reconciliation.

**People** — customers with credit limits and outstanding balances, reward
points with membership tiers, suppliers, staff with roles, commissions.

**Operations** — dashboards, expense tracking, notifications, automatic local
backups, an audit log of every consequential action.

**Reports** — a day book that answers "what should be in the drawer" rather
than "what did we sell", with cash tracked separately from card and UPI
throughout; sales sliced by brand, category, size or salesperson; item-wise
margin computed from the cost recorded at the time of sale, which reports how
much of a period it could not cost rather than quietly leaving it out. Bills
can be found by phone number when the customer has lost their copy.

---

## Repository layout

| Path | What it is |
|---|---|
| `desktop/` | The Electron application — React 19 renderer, Electron main, SQLite local store |
| `backend/` | FastAPI + PostgreSQL server — the system of record |
| `mobile/` | An Expo companion app. **Not covered by the production audit** |
| `docker-compose.yml` | Local PostgreSQL for development |

Full breakdown in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Requirements

| | Version |
|---|---|
| Node.js | 20.x (verified on 20.20.2) |
| Python | 3.13+ (verified on 3.14.4) |
| PostgreSQL | 15+ (or Docker) |
| OS for packaging | Windows 10/11 for the `.exe` |

---

## Getting started

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows;  source .venv/bin/activate elsewhere
pip install -e ".[dev]"
cp .env.example .env
```

Start PostgreSQL and apply migrations:

```bash
docker compose up -d
cd backend && alembic upgrade head
```

Run it:

```bash
cd backend && uvicorn app.main:app --reload
```

API docs are at `http://localhost:8000/docs` — **disabled automatically in
production**.

### 2. Desktop

```bash
cd desktop
npm install
cp .env.example .env             # point VITE_API_BASE_URL at your backend
npm run dev
```

`npm run dev` starts Vite on port **5273** and launches Electron against it.
The port is deliberately not Vite's default 5173, which other projects contest.

---

## Everyday commands

Run these from `desktop/`:

| Command | What it does |
|---|---|
| `npm run dev` | Vite + Electron, hot reload |
| `npm test` | **Full** suite (475 tests). Rebuilds the native module first — use this, not bare `vitest` |
| `npm run typecheck` | Type-checks renderer *and* main process |
| `npm run build` | Production renderer + main bundles |
| `npm run dist:win` | Windows installer → `release/` |

From `backend/`:

| Command | What it does |
|---|---|
| `pytest` | Backend suite (327 tests). Run it ALONE — two concurrent runs share one SQLite file and fail in ways that look like real defects |
| `alembic upgrade head` | Apply migrations |
| `alembic revision --autogenerate -m "..."` | New migration |

> **Why `npm test` and not `npx vitest`:** `better-sqlite3` is a native module
> compiled against Electron's ABI. Vitest runs under plain Node. `npm test`
> rebuilds it for Node, runs the suite, then rebuilds it back for Electron.
> Running bare `vitest` gives a `NODE_MODULE_VERSION` error on every
> database-backed test. It also fails if the app is open — the file is locked.

---

## Documentation

| Document | Read it when |
|---|---|
| **[USER_MANUAL.md](USER_MANUAL.md)** | You are a shop owner or cashier using the app |
| **[DEPLOYMENT.md](DEPLOYMENT.md)** | You are installing or updating it for a client |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | You are changing the code |
| **[PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md)** | You need the security and readiness position |
| [DEPLOY.md](DEPLOY.md) | First-ever setup from an empty machine (original guide) |

---

## Status

**578 automated tests pass** — 132 backend, 446 desktop. Type checking is
clean, `npm audit --omit=dev` reports zero vulnerabilities, and the packaged
application has been launched and verified to migrate and open its database.

Read **[PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md) §6 and §7** before shipping to
a client. Two things matter most:

- Building the `.exe` on Windows needs **Developer Mode or an Administrator
  terminal** (a Windows privilege issue, not a code defect).
- The application is **not code-signed**, so SmartScreen will warn on first run.

---

## Non-negotiables when contributing

These are invariants, not style preferences. Breaking one loses money.

1. **Never use floating point for money.** `Numeric` on the server, integer
   paise on the terminal, string arithmetic in the display layer.
2. **Commit locally before the network.** No billing path may await a server.
3. **Returns are stored as negative amounts.** Roughly 40 aggregate queries
   depend on it.
4. **A printed SKU is not a barcode.** Never assume they are the same value.
5. **Never render a failed request as an empty state.** "No results" and "the
   server did not answer" are different facts, and confusing them has already
   caused one real bug in this codebase.
6. **`.env` files are secrets.** Never stage them.
