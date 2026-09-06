# Production Audit — RetailOS / JR Retail OS

**Audit date:** 5 September 2026
**Version audited:** 0.1.0 (desktop + backend)
**Scope:** Electron main / preload / renderer, IPC boundary, local SQLite store,
offline sync, FastAPI backend, build and packaging.

This document records what was actually inspected, what was actually run, and
what was actually fixed. Where something was **not** verified, it says so. A
production audit that overstates its coverage is worse than none, because it
retires a risk that is still live.

---

## 1. Verdict

| Area | Status |
|---|---|
| Electron process security | **Fixed** — one exploitable defect closed |
| IPC boundary | **Sound** — 32/32 channels matched, all validated |
| Backend production guards | **Fixed** — auth-bypass configuration now refuses to boot |
| Offline / sync correctness | **Sound** — design reviewed, 446 tests run and passing |
| Financial correctness | **Sound** — no floating-point money found in new or audited paths |
| Packaged build | **Verified running** — launches, migrates, WAL, integrity OK |
| Windows installer (`.exe`) | **Blocked** — environment privilege, not a code defect (§6) |
| Automated test suite | **578 passing** (132 backend, 446 desktop) |

**Overall:** suitable for a controlled pilot with the named client, subject to
the open items in §6 and the limitations in §7. It is not yet suitable for
unattended distribution to unknown customers — the code-signing story is
unresolved (§7.1).

---

## 2. Problems found and fixed

### 2.1 Arbitrary OS command execution via `shell.openExternal` — **HIGH**

`electron/main.ts` passed unvalidated URLs to `shell.openExternal` from both the
window-open handler and the will-navigate handler.

`openExternal` does not "open a web page" — it asks Windows to run whatever is
registered for the URL's scheme. A `file:///…/payload.exe` launches the binary.
Schemes such as `ms-msdt:` and `search-ms:` have been used in real attacks to
obtain code execution from a single crafted link. The renderer renders supplier
names, customer notes and product data that originate in a database, so a
hostile string reaching a link is a realistic path rather than a theoretical
one.

**Fixed:** allow-list of `http:`, `https:`, `mailto:` in
`electron/security/navigation.ts`. Everything else is refused and logged.
Allow-list, never deny-list, so a scheme that turns out to be dangerous later is
refused by default.

### 2.2 Origin confusion in the navigation guard — **MEDIUM**

The same handler decided "is this internal?" with
`url.startsWith(VITE_URL)`. `http://localhost:5273.evil.com` satisfies that
prefix test and is a completely different origin, so it would have been treated
as internal and allowed to navigate in-window.

**Fixed:** compared by parsed `URL.origin`. Both defects are pinned by 13 tests
in `electron/security/__tests__/navigation.test.ts`.

### 2.3 Forgeable authentication tokens in production — **CRITICAL**

`SECRET_KEY` signs every JWT and defaults to `change-me` in
`backend/app/core/config.py`. Nothing checked it. The CORS wildcard *was*
guarded; the signing key was not — which is backwards, because a wildcard CORS
policy is rejected by browsers when combined with credentials, whereas a known
signing key is silently exploitable.

Deployed without setting `SECRET_KEY`, anyone who has read this repository could
mint a valid token for any user id and call any endpoint as the owner. Nothing
in the system would detect it: the forged token is cryptographically valid.

**Fixed:** `_assert_signing_key_is_safe` in `backend/app/main.py` refuses to
start a **production** app with a placeholder or short key. Development and test
are untouched, so local setup and CI are unaffected.

The guard also rejects the 68-character placeholder shipped in
`backend/.env.example`, which a length check alone would wave through and which
is the single likeliest value to reach production — copying `.env.example` to
`.env` is the first thing a deployer does. 11 tests in
`backend/tests/test_production_guards.py`.

### 2.4 Complete application source shipped to every client — **MEDIUM**

`vite.config.ts` set `sourcemap: true` unconditionally, putting a 4.2 MB source
map inside every installer. Combined with DevTools being deliberately left
reachable for support, the app's entire original source was readable on any
client machine. The main-process maps (IPC handlers, credential vault) were
shipped too.

**Fixed:** production source maps are now opt-in via `RETAILOS_SOURCEMAP=1`, and
`**/*.map` is excluded from the packaged files. Development is unaffected.

### 2.5 Installer carrying build inputs — **LOW**

The package included SQLite's C amalgamation and intermediate object files —
inputs needed only to compile the native module, never at runtime.

**Fixed:** excluded in `build.files`. Measured effect: **app.asar 51.7 MB →
26.5 MB (−49%)**, with `better_sqlite3.node` still correctly unpacked outside
the asar (verified — it cannot load from inside one).

### 2.6 A comment that described behaviour the code did not have — **LOW**

The CORS block was commented "refuse to boot production with a wildcard origin
… we fail loud instead of silently allowing it". It only logged a warning.

**Fixed:** the comment now describes what the code does, and says why warning is
the right call there while the signing key refuses.

---

## 3. Audited and found sound (no change needed)

These were inspected and are recorded so a future reader does not re-audit them
blindly.

- **Electron hardening.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, permission requests globally denied, window-open denied.
  Correct.
- **Content-Security-Policy.** Present in `index.html`; `script-src 'self'`,
  no third-party JS. `connect-src` is deliberately broad so the operator can
  point the app at any backend URL — a documented trade-off, not an oversight.
- **IPC boundary.** 32 channels registered, 32 exposed, **no orphans in either
  direction**. Every handler validates its arguments and returns a
  discriminated result; `wrap()` prevents raw exceptions (and SQLite error
  strings) crossing to the renderer. No channel accepts SQL or a filesystem
  path. Now pinned by `electron/ipc/__tests__/surface.test.ts`.
- **SQL injection.** All statements parameterised. The single template literal
  found is a constant `SELECT` prefix followed by `?` placeholders.
- **XSS.** No `dangerouslySetInnerHTML`, no `eval`, no `new Function`.
- **Secrets.** No hardcoded credentials. Only `.env.example` files are tracked;
  `.env` and `.env.*` are gitignored.
- **Dependencies.** `npm audit --omit=dev`: **0 vulnerabilities**.
- **Debug code.** No stray `console.log` outside the logger itself. Renderer
  request logging is gated on `import.meta.env.DEV`, so a packaged build cannot
  leak bearer tokens.
- **Backend production posture.** OpenAPI/docs disabled in production,
  TrustedHost enforced, rate limiting on auth routes, security headers
  middleware, structured logging with request IDs.
- **Sync failure classification.** `electron/sync/error-classifier.ts` is
  carefully reasoned and correct on the point that matters most: a transport
  timeout is retryable *because the server may have committed*, and the retry
  carries the same `client_uuid` so the server's idempotency check collapses the
  replay instead of ringing the bill up twice. 401/403 are retryable rather than
  permanent, so an expired overnight token cannot bury a real sale.

---

## 4. Tests performed

All figures below are from runs executed during this audit, not estimates.

| Suite | Command | Result |
|---|---|---|
| Backend | `pytest` | **132 passed** |
| Desktop (full, incl. SQLite) | `npm test` | **446 passed**, 24 files |
| Type checking | `npm run typecheck` | Clean (renderer + main) |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Renderer production build | `npm run build` | Clean |
| Packaging | `electron-builder --win --dir` | Succeeded |
| **Packaged app launch** | ran `RetailOS.exe` | **Window opened, stayed up** |
| **Packaged app database** | inspected `%APPDATA%\RetailOS` | 8/8 migrations, WAL, `integrity_check: ok` |

The desktop suite covers offline sale commit, sync payload building, sync queue
mechanics and convergence, backup and restore, catalog sync, session
attribution, receipt formatting, scanner input classification, cart rules and
money handling.

**Note on the desktop suite:** it requires `better-sqlite3` rebuilt for Node
rather than Electron, which `npm test` does automatically. Running bare
`npx vitest` while the app is open fails with a `NODE_MODULE_VERSION` error on
every database-backed test — that is an environment mismatch, not a failure.

---

## 5. Tests added during this audit

| File | Tests | What it protects |
|---|---|---|
| `electron/security/__tests__/navigation.test.ts` | 13 | §2.1, §2.2 |
| `electron/ipc/__tests__/surface.test.ts` | 4 | IPC bridge/handler drift |
| `backend/tests/test_production_guards.py` | 11 | §2.3 |
| `electron/database/__tests__/store-snapshot.test.ts` | 6 | Shop identity on receipts |
| `src/lib/__tests__/money.test.ts` | 17 | Display-layer money formatting |
| `src/lib/__tests__/elevation.test.ts` | 7 | Re-auth window expiry |
| `backend/tests/test_password_gate.py` | 8 | Destructive-action gate |
| `backend/tests/test_loyalty.py` | 24 | Points as a financial liability |

The IPC surface test deserves a note: the preload bridge and the main-process
handlers are connected only by a string, with nothing in TypeScript relating
them. Both failure modes are silent — an exposed channel with no handler fails
at runtime when a user reaches the feature; a handler with no bridge entry is
unreachable code that still widens the attack surface.

---

## 6. Open items

### 6.1 Windows installer cannot be built on this machine — **BLOCKING for `.exe` delivery**

`electron-builder` downloads a code-signing toolchain and extracts it with 7-Zip.
The archive contains **macOS** symlinks, and creating a symlink on Windows
requires a privilege this account does not hold:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
    …winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

This is an **environment prerequisite, not a code defect**. Confirmed by
building successfully with the signing step skipped. Pre-extracting the cache
does not help: a fresh randomly-named temp directory is used on every attempt
(≈37 abandoned ones were found in the cache).

**Fix — either:**
1. Enable **Developer Mode** (Settings → System → For developers), which grants
   symlink creation, then `npm run dist:win`; or
2. Run `npm run dist:win` from an **Administrator** terminal.

Everything else in the pipeline is verified working, including the packaged app
launching and initialising its database.

### 6.2 Backend deployment has not been updated

`origin/main` is behind local `main`. Render has not deployed since `56b08db`,
so migrations `0015`–`0021` are **not applied** to the hosted database and none
of this work is live. Cause is outside the repository — an auto-deploy setting
or a failed build — and needs the Render dashboard. **No deployment was
performed during this audit** (not requested, and out of scope for an audit).

### 6.3 Redemption does not reduce a bill automatically

Loyalty points can be earned, quoted, redeemed and audited, but redeeming
records the value against the customer rather than discounting the open bill.
There is no bill-level discount in the schema — only per-line `discount_pct` —
and spreading a flat amount across lines changes each line's taxable value and
therefore its GST. That is a tax-compliance decision, not a UI change. The
panel states this plainly rather than quietly doing it wrong.

### 6.4 Sale void has no user interface

`POST /sales/{id}/void` is implemented, password-gated and tested, and
`voidSale` exists in the API client, but no screen calls it.

### 6.5 Thermal receipt shop details are untested against hardware

The shop name, address and GSTIN now reach the receipt formatter and are covered
by unit tests. **No physical thermal printer has ever been used.** The printer
service reports `physicalHardwareVerified: false` in its own status payload, and
that is accurate.

---

## 7. Known limitations

### 7.1 The application is not code-signed

Windows SmartScreen will warn on first run and some antivirus products may
quarantine an unsigned installer. Distributing to a single known client is
workable; wider distribution needs an EV or OV code-signing certificate.

### 7.2 "Remember me" stores the password, not a revocable token

`retailos-credentials.enc` holds the email and password, encrypted with
Windows DPAPI and bound to the OS user account. That is sound against another
user on the same machine or someone with the file alone. It is weaker than
necessary against compromise of the OS user session, because a password cannot
be revoked server-side the way a refresh token can — and the app already stores
refresh tokens. **Recommended for a future release**, not changed here
because it touches the login path and warranted its own testing cycle.

### 7.3 DevTools are reachable in packaged builds

A deliberate product decision so support can diagnose a shop's PC via F12. It
means a determined user can inspect application state and network traffic. With
source maps now excluded, they can no longer read the original source.

### 7.4 Stock is allowed to go negative

By design: a cashier at a counter must never be blocked because goods-receipt
paperwork is behind physical reality. Negative rows remain visible on inventory
reports for reconciliation. Correct for this business, surprising if unexpected.

### 7.5 Points expiry runs on an interval, not a calendar

The sweep runs every 24 hours from process start rather than at a fixed local
time. Points may lapse up to a day later than a strict reading of the policy.
Acceptable for a loyalty scheme; would matter for anything contractual.

### 7.6 Roughly 33 database columns still have no screen

Expense approval trail, day-session opener/closer, void reason, second address
lines, several `sort_order` fields. Data is stored and preserved; there is
simply no UI to view or edit it.

### 7.7 The `mobile/` Expo application was not audited

Out of the stated scope (Electron POS). It has not been reviewed, tested or
verified by this audit and no claim is made about it.

### 7.8 No load or concurrency testing was performed

Correctness under concurrent access is enforced by `SELECT … FOR UPDATE` on
stock balances, invoice sequences and loyalty balances, and is covered by unit
tests. **Behaviour under real multi-terminal load has not been measured.**

---

## 8. Files changed in this audit

**Security fixes**
- `desktop/electron/security/navigation.ts` *(new)*
- `desktop/electron/main.ts`
- `backend/app/main.py`

**Build and packaging**
- `desktop/vite.config.ts`
- `desktop/package.json` (`build.files`)

**Tests**
- `desktop/electron/security/__tests__/navigation.test.ts` *(new)*
- `desktop/electron/ipc/__tests__/surface.test.ts` *(new)*
- `backend/tests/test_production_guards.py` *(new)*

**Documentation**
- `README.md`, `DEPLOYMENT.md`, `ARCHITECTURE.md`, `USER_MANUAL.md`,
  `PRODUCTION_AUDIT.md` *(all new)*

The pre-existing `DEPLOY.md` was left in place; it covers first-time setup from
scratch, while `DEPLOYMENT.md` is the operational reference.

---

## 9. What was deliberately not done

- **No commit, push, or deploy.** Not requested; the standing instruction on
  this project is to leave that to the owner.
- **No rewriting of working code.** Refactors were limited to what a specific
  defect required. The offline sync engine, billing flow and inventory service
  were reviewed and left alone because they are correct.
- **No dependency upgrades.** `npm audit` is clean; upgrading Electron or
  FastAPI mid-audit would invalidate every test result above.

---

## Addendum — 6 September 2026

**This section records what changed AFTER the audit above.** The audit's
findings are left exactly as written: an audit is a record of what was true on
the day it was performed, and editing its conclusions later would destroy the
only thing that makes it worth having.

### Findings above that are now closed

| Finding | Status |
|---|---|
| §6.3 Redemption does not reduce a bill | **Closed.** Bill-level discount exists (migration 0025), and `redeem_points` on `SaleCreate` folds the points' value into it inside the same transaction that writes the sale. |

### Go-live blocker closed

**Opening stock could not be established.** The legacy import deliberately
brought over products and variants but not stock, because the old system's
quantities could not be trusted — so every variant read zero with no supported
way to correct it in bulk. Physical stock audit (migration 0027) is now
implemented: blind count sheets, per-line variance, and posting to the stock
ledger. 19 tests.

The design decision worth recording: a sheet posts the **variance measured when
each line was entered**, not the counted total. A sheet filled in at 6pm and
posted at 9pm contains an evening of sales; setting the balance to the counted
figure would put every one of those units back on the shelf, overstating stock
by exactly the evening's takings with nothing in the ledger to show for it.

### Defects found and fixed while adding features

Two were pre-existing and are worth naming, because both were silent:

- **"Total payable" showed the gross.** The billing screen sent the bill
  discount and round-off to the server but never subtracted them from the
  figure on screen, and prefilled that same wrong figure into amount-paid. The
  counter was asking for money the bill did not owe.
- **An offline bill committed to SQLite at its gross.** The discount travelled
  in the queued payload but not into the local row, so the receipt handed over
  at the counter disagreed with what later reached PostgreSQL. This breached
  `RECEIPT = SQLITE = POSTGRESQL`, the invariant the whole offline design rests
  on. Local migration 009 gives the sale its own bill-discount, coupon, points
  and round-off columns.

### Test counts at this addendum

| Suite | Count |
|---|---|
| Backend (pytest) | **308 passing** |
| Desktop (vitest) | **466 passing** |

Backend and desktop suites must be run **separately**; two concurrent pytest
runs share one SQLite file and produce failures that are artefacts of the
collision rather than real defects. The desktop suite must be run with
`npm test`, not `npx vitest` — the former rebuilds `better-sqlite3` against
Node's ABI and back against Electron's afterwards.

### Limitations that remain unchanged

Everything in §7 still stands. In particular:

- **No physical thermal printer has ever been exercised.** The receipt
  formatter now prints bill discounts, points redeemed and round-off, and that
  is verified only through the formatter's own tests. `physicalHardwareVerified`
  remains `false`.
- **The Windows installer still cannot be built** in this environment — a
  symlink privilege, not a code defect.
- **MS1's legacy dump was never obtained.** Both dump files supplied are MS2.
