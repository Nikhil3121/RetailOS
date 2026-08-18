# RetailOS

Production-grade Retail Operating System — Python (FastAPI) backend + Electron/React desktop client.

This repository is being built in phases. **Phase 1 complete. Current milestone: Phase 2 · Milestone 7 — Audit Logs & Dashboard Customization.**

---

## Repository layout

```
Retail OS/
├── backend/         # FastAPI service (Clean Architecture, SQLAlchemy 2 async, Alembic)
├── desktop/         # Electron + Vite + React 19 + TypeScript + Tailwind renderer
├── docker-compose.yml
├── .env.example
└── README.md
```

Each half of the system is independently runnable, versioned, and testable. They meet only at the HTTP boundary.

---

## Quick start

Prerequisites (install yourself — you told me to skip verification):

- Python **3.13+** (with `uv` or `pip`)
- Node.js **20+** with `pnpm` (or `npm`)
- Docker Desktop (for Postgres + Redis)

### 1. Start infrastructure

```bash
docker compose up -d postgres redis
```

Postgres will be listening on `localhost:5432` (user `retailos` / password `retailos` / db `retailos`), Redis on `localhost:6379`. Data is persisted under Docker volumes `retailos_pgdata` / `retailos_redisdata`.

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env
alembic upgrade head              # applies the identity schema (stores, users, refresh_tokens)
python -m app.cli.seed_admin --email admin@retailos.local --password "Strong!Pass123"
uvicorn app.main:app --reload --port 8000
```

`seed_admin` is idempotent — safe to re-run to reset the super admin password.

API is now on `http://127.0.0.1:8000`. OpenAPI docs at `/docs`.

### 3. Desktop app

In a second terminal:

```bash
cd desktop
pnpm install
pnpm dev
```

The Electron window opens against Vite's dev server (`http://localhost:5173`) and routes you to `/login`. Sign in with the credentials you passed to `seed_admin`. From there you can create users, create stores, and change your own password.

---

## Architecture principles (Phase 1)

- **Clean Architecture / DDD-lite** — `api` → `services` → `repositories` → `db.models`. No layer skips.
- **Async all the way** — SQLAlchemy 2 async engine, async endpoints, async sessions per request.
- **Config via Pydantic Settings** — 12-factor, environment-driven, typed at load time.
- **Everything is a package** — no loose scripts, every module has a docstring stating its responsibility.
- **Frontend is presentational only** — no business logic in React; all rules live in Python services.

Later milestones layer auth, catalog, inventory, purchasing, POS, and reporting onto this foundation without changing the shape of these layers.

---

## Roadmap

| Milestone | Scope |
|---|---|
**Phase 1 — Retail Operating System foundation** *(complete)*

| Milestone | Scope |
|---|---|
| 1 — Foundation ✓ | Repo scaffold, backend + desktop skeletons, theming, health wire-up |
| 2 — Identity ✓ | JWT + refresh, argon2, RBAC, users, stores, login/forgot/change UI |
| 3 — Catalog ✓ | Categories, brands, units, products, variants, SKU/barcode, pricing, images |
| 4 — Operations ✓ | Suppliers, customers, stock ledger, purchase orders |
| 5 — Point of Sale ✓ | POS billing, GST invoicing, day open/close, cash reconciliation, sales history, basic reports |

**Phase 2 — Business Intelligence & Advanced Retail** *(in progress)*

| Milestone | Scope |
|---|---|
| 1 — BI Dashboard & Reports ✓ | Real-time KPIs w/ period comparison, hourly + daily charts, payment mix donut, top products, store comparison, CSV export |
| 2 — Staff & Commission ✓ | Staff performance rankings, commission engine (global/product/category/brand rules), staff targets with live achievement |
| 3 — CRM & Loyalty ✓ | Loyalty program + membership tiers, points ledger with auto-earn on sale, wallet, coupons + validation, customer timeline |
| 4 — Inventory Intelligence & Purchase Analytics ✓ | Stock-level categorisation, movement velocity, dead/fast/slow detection, inventory value + aging, supplier scorecards, purchase trends, top-cost analysis |
| 5 — Expense Management ✓ | Expense categories, entry with receipt URL, submit/approve/reject workflow, per-store or org-wide, P&L rollup (revenue − COGS − opex) |
| 6 — Notifications & Background Jobs ✓ | Persisted notifications, configurable rules, email dispatcher (SMTP or log fallback), WhatsApp/push stubs, APScheduler running low-stock + day-close jobs, in-app bell with unread badge |
| **7 — Audit Logs & Dashboard Customization** *(current)* | Append-only audit log hooked into login/logout/sale/expense/user changes, filterable audit page, per-user dashboard section show/hide + save layout |
| 4 — Inventory Intelligence | Low/dead/fast-moving detection, supplier performance |
| 5 — Expense Management | Categories, approval, P&L impact |
| 6 — Notifications + Background Jobs | Celery, Redis, email/desktop/push |
| 7 — Audit Logs + Dashboard Customization | Activity trail, widget layout |
| 4 — Operations | Inventory, purchasing, suppliers, customers |
| 5 — Point of Sale | Billing, GST invoicing, day open/close, cash, basic reports |

Phases 2/3/4 (BI, AI, SaaS platform) are separate multi-milestone tracks and are not yet started.
