# Architecture — RetailOS

For engineers changing this code. It explains **why** the system is shaped this
way, because most of the shape is a response to a specific failure that costs a
real shop real money.

---

## 1. The premise

A till in a market town in India cannot depend on the internet. Power cuts,
patchy mobile data, and a router shared with the shop next door are the normal
condition, not the exception. Every design decision below follows from that.

**The invariant the whole system defends:**

```
RECEIPT  ==  SQLITE  ==  POSTGRESQL
```

The number handed to the customer on paper, the number in the terminal's local
database, and the number in the server's database are the same. Not eventually
the same — the same, with any divergence being a bug of the highest severity.

---

## 2. The three processes

```
┌──────────────────────────────────────────────────────────┐
│  RENDERER  (Chromium, sandboxed, no Node)                │
│  React 19 · TypeScript · Tailwind · TanStack Query       │
│  48 pages. The ONLY authenticated party — it holds the   │
│  bearer token and talks to the backend over HTTPS.       │
└───────────────────────┬──────────────────────────────────┘
                        │  contextBridge — 32 named channels
                        │  no Node, no SQL, no filesystem
┌───────────────────────▼──────────────────────────────────┐
│  PRELOAD  (electron/preload.ts)                          │
│  Exposes window.retailos.*  Nothing else crosses.        │
└───────────────────────┬──────────────────────────────────┘
                        │  ipcRenderer.invoke
┌───────────────────────▼──────────────────────────────────┐
│  MAIN  (Node)                                            │
│  SQLite (better-sqlite3, WAL) · thermal printing ·       │
│  backups · sync engine · OS credential vault             │
│  NOT authenticated. Never calls the backend on its own   │
│  except during an explicitly-triggered sync.             │
└──────────────────────────────────────────────────────────┘
```

**Security posture:** `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, all permission requests denied, window-open denied, external
navigation restricted to an allow-list of `http`/`https`/`mailto`.

### Why the split matters

The renderer is the only process that is authenticated, so it is the only one
that can read from the server. The main process is the only one that can touch
the disk. Anything needing both — printing a receipt with the shop's GSTIN, for
instance — must move data across the bridge deliberately:

> The renderer fetches the store from the server and pushes it down via
> `store:snapshot`. The printer reads it back out of SQLite. That indirection
> is the point: it is what keeps the GSTIN on the receipt during an outage.

### The IPC contract

Every channel is a **named operation**, never a passthrough. There is no channel
that accepts SQL, a filesystem path, or a shell command. Every handler:

1. validates each argument (`electron/ipc/validation.ts`),
2. delegates to a repository — all SQL lives there,
3. returns `{ ok: true, data }` or `{ ok: false, error, code }`.

`wrap()` guarantees no exception crosses the boundary. Internal SQLite error
strings are replaced with generic messages, because they disclose schema and
filesystem layout to a renderer that should not have either.

The bridge and the handlers are related only by a string, so
`electron/ipc/__tests__/surface.test.ts` asserts they match exactly in both
directions.

---

## 3. Money

**Never floating point. Anywhere. Including display.**

| Layer | Representation |
|---|---|
| PostgreSQL | `Numeric(14,2)` |
| Python | `Decimal`, explicitly quantised |
| SQLite (terminal) | **integer paise** |
| Renderer display | string arithmetic (`src/lib/money.ts`) |

The display layer is included on purpose. `Number("180.00000")` is how money
bugs get in: once a value has been through a float the rounding has already
happened and nothing downstream can undo it. `money.ts` therefore does Indian
digit grouping and half-up rounding on strings, and `sumDecimals` adds via
`BigInt` — which caught a live defect where a payment-mix total was a float sum
that could disagree with the four rows printed beneath it.

**Rounding direction is a decision, not a detail.** Loyalty points round *down*
on earning and redemption value rounds *down*, because rounding up a fraction on
every bill is the shop giving away money it never agreed to.

---

## 4. Offline-first billing

```
Scan → Cart → Tender
                │
                ▼
      ┌───────────────────────┐
      │ COMMIT TO SQLITE      │   ← transaction is now durable
      │ + queue a sync job    │
      └──────────┬────────────┘
                 │
                 ▼
           PRINT RECEIPT          ← customer leaves; nothing has touched
                 │                  the network yet
                 ▼
      ┌───────────────────────┐
      │ Background sync       │   ← whenever the network allows
      └───────────────────────┘
```

Billing **never awaits the network**. A sale is durable before the receipt
prints.

### No duplicates, ever

Every offline sale carries a client-generated `client_uuid`. On the server,
`uq_sales_client_uuid` plus a SAVEPOINT (`begin_nested`) makes a replay collapse
onto the existing row.

Critically this is **not** a SELECT-before-INSERT check, which has a race
between the read and the write. The database decides, and a caught
`IntegrityError` means "this sale already exists" — so a timeout where the
server committed but the terminal never heard back resolves correctly on retry
instead of ringing the bill up twice.

The savepoint matters for a subtle reason: an outer rollback would undo the
right rows but also expire every object in the session, including the
authenticated user, and the endpoint still has audit logging to do. Unwinding
only to the savepoint keeps the session alive.

### Failure classification

`electron/sync/error-classifier.ts` sorts every failure into three kinds:

| Kind | Meaning | Examples |
|---|---|---|
| `RETRYABLE` | Verdict unknown or temporary | 5xx, 429, timeout, **401/403** |
| `BLOCKED` | A business state that may clear | 409, unknown conflict |
| `PERMANENT` | The server understood and refused | 422, most 4xx |

Two choices are deliberate and load-bearing:

- **401/403 is retryable.** A shift token expiring overnight must not
  permanently bury a real sale. A fresh login fixes it; the bill was always fine.
- **An unknown 409 blocks rather than fails.** Blocking keeps the sale alive and
  visible; permanent would bury it.

### Sale-time attribution

A bill rung at 21:40 belongs to the shift that was open at 21:40. The terminal
records `server_day_session_id`, `occurred_at` and `terminal_uuid` **at commit
time** and the server never re-derives them.

Resolving these at sync time is the bug, not the fix: an overnight outage would
move last night's takings into today's shift and corrupt the cash
reconciliation of both. A late sale against a closed shift triggers an audited
**restatement** rather than silently changing closed books.

---

## 5. Data model — the parts with sharp edges

### Returns are negative

A credit note is a `Sale` row with `doc_type = RETURN` and **negative** amounts.
Roughly 40 aggregate queries therefore need no special-casing: sum the column
and returns subtract themselves. Sign conversion happens in exactly one place,
so a caller cannot double-credit by sending `-2`.

### Separate GST serial series

`INV-` for sales, `CRN-` for credit notes, `ADV-` for advances, allocated under
`SELECT … FOR UPDATE` on the sequence row. Sharing one series across document
types is a GST filing problem.

### Price resolution has exactly one authority

`PriceListService.resolve` is the **only** place a selling rate is chosen:
customer's list → default list → the variant's own `selling_price`. The billing
screen and the sale service call the same function, so what the cashier sees and
what is written to the bill cannot diverge.

### Bundles move their components

A "saree + blouse" combo is a way of selling, not a thing on a shelf. Selling a
bundle decrements its **components**; the bundle itself is never stocked.
Decrementing both would count the same garment twice. Nested bundles are
refused rather than half-supported.

### Snapshot anything a customer might read later

`sale_lines.mrp`, `tax_rate` and `line_total` are stored as they were **at the
time of sale**. Reading today's MRP onto a three-month-old bill would show a
customer a saving they never received.

### Loyalty: the ledger is the truth

`customer_loyalty.points_balance` is a **cache**. `loyalty_ledger` is
authoritative, and every row carries the balance it produced. Points are a
liability, and the question asked about a liability is never "what is the
balance" — the screen already says that — it is "why". Redemption takes
`SELECT … FOR UPDATE`, exactly as stock and invoice sequences do.

---

## 6. Concurrency

Row locks, not optimistic retries, on the three things two counters can touch at
once:

| Resource | Why |
|---|---|
| Stock balances | Two tills selling the last piece |
| Invoice sequences | Duplicate GST invoice numbers are a filing problem |
| Loyalty balances | Read-then-write without a lock spends the same points twice |

**Stock is allowed to go negative.** A cashier must never be blocked because
goods-receipt paperwork is behind physical reality. Negative rows stay visible
on inventory reports for reconciliation.

---

## 7. Authentication and authorisation

Three independent layers:

1. **Bearer JWT** with refresh-token rotation. Optional TOTP 2FA.
2. **Roles** — `super_admin > owner > manager > cashier > staff`, enforced by
   `require_min_role` on the route.
3. **Elevation** — destructive actions (18 delete routes and sale void) need a
   password re-entry within the last 5 minutes, sent as `X-Elevation-Token`.

Elevation is a **separate JWT type** from access on purpose. If an access token
satisfied the check, every logged-in session would already hold the key and the
gate would be decoration. The token must also name the same user as the access
token, so one person's five-minute window cannot be borrowed by whoever sits
down at the terminal next.

The gate is enforced **server-side**. A dialog drawn only in the renderer stops
nobody: the endpoint is reachable directly, and the scenario the shop is worried
about is an unattended till with a live session — exactly what a client-side
prompt does nothing about.

---

## 8. Local storage

`better-sqlite3`, WAL mode, at `%APPDATA%/RetailOS/retailos.db`.

**WAL** so readers never block the writer — on a till that matters the moment a
report is opened while a sale is being rung up.

**Migrations** (`electron/database/migrations/`) are ordered, tracked in
`schema_migrations`, atomic per migration, and have no down-path. A failure
rethrows: the app must not run against a half-migrated schema. Never renumber or
edit a shipped migration.

**Backups** run on a timer to `%APPDATA%/RetailOS/backups/`, each with a JSON
manifest, rotated on retention. Started only when the database actually opened —
backing up a failed database would rotate good copies out in exchange for
nothing.

---

## 9. Backend

FastAPI + SQLAlchemy 2 (async) + PostgreSQL, 30 endpoint modules, Alembic
migrations `0001`–`0021`.

Layering is strict: **endpoints** deserialise and delegate; **services** hold
every rule; **models** are storage. Business logic in an endpoint is a bug.

Production guards, in order of severity:

- **Refuses to boot** if `SECRET_KEY` is a placeholder or under 32 characters.
  That is the one setting worth refusing over: a known signing key is not weak
  authentication, it is *no* authentication, and it is silently exploitable.
- Warns on wildcard CORS (browsers already reject `*` with credentials, and
  hard-failing would take a shop offline over a setting that degrades safely).
- Disables `/docs`, `/redoc` and `/openapi.json`.
- Enforces `TrustedHost`, rate-limits auth routes, adds security headers.

---

## 10. Where things live

```
desktop/
  electron/
    main.ts                  Window, credential vault, lifecycle
    preload.ts               The bridge — 32 channels
    security/navigation.ts   URL allow-listing
    ipc/                     Handlers + argument validation
    database/
      migrations/            Ordered, tracked, no down-path
      repositories/          ALL SQL lives here
    sync/                    Payload building, queue, error classification
    printing/                ESC/POS encoding + receipt layout
    catalog/                 Catalog pull + validation
  src/
    pages/                   48 screens
    components/              Shared UI
    lib/                     API clients, money, cart rules, scanner
    stores/                  Zustand — auth, UI

backend/
  app/
    api/v1/endpoints/        30 routers — thin
    services/                All business rules
    db/models/               SQLAlchemy models
    schemas/                 Pydantic DTOs
    core/                    Config, security, middleware, scheduler
  alembic/versions/          0001 … 0021
  tests/                     132 tests
```

---

## 11. Rules for changing this code

1. **Never introduce floating-point money.** Including in display code.
2. **Never make billing await the network.**
3. **Never render a failed request as an empty state.** "No results" and "the
   server did not answer" are different facts. This has already caused a real
   bug here — a failed day-session check fell through to "open a new session",
   which would have let a cashier open a second shift.
4. **Never assume a printed SKU is a barcode.**
5. **Never edit or renumber a shipped migration.**
6. **Put business rules in services**, never in endpoints or components.
7. **Snapshot anything a customer may read back later.**
8. **Add the test that would have caught it.** Every fix above has one.
