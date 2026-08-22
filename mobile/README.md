# RetailOS Mobile

React Native + Expo companion app for RetailOS. Shares the same backend
(`https://retailos-backend-8jwi.onrender.com`) and Postgres data as the
desktop client under `../desktop/`. Kept in its own folder so the desktop
build pipeline is never disturbed.

**Status: scaffold only.** Folder tree is in place; Expo has not been
initialised yet. See "Bootstrapping" below when you're ready to start
writing the app.

---

## Folder structure

```
mobile/
├── README.md                     ← this file
├── .gitignore                    ← Expo / RN-specific ignores
├── assets/                       ← app icon + splash + fonts (Expo eats this)
└── src/
    ├── api/                      ← thin fetch wrappers around the backend
    │                                (mirrors desktop/src/lib/*-api.ts)
    │                                - api.ts           base fetch + auth
    │                                - auth-api.ts
    │                                - catalog-api.ts
    │                                - sales-api.ts
    │                                - day-sessions-api.ts
    │                                - customers-api.ts
    │
    ├── components/               ← reusable UI atoms
    │                                (Button, Card, Chip, Input, etc.)
    │
    ├── screens/                  ← one folder per feature area, one file
    │   ├── auth/                    per screen inside
    │   │   └── LoginScreen.tsx
    │   ├── dashboard/
    │   │   └── DashboardScreen.tsx
    │   ├── billing/
    │   │   ├── NewBillScreen.tsx
    │   │   ├── HeldBillsScreen.tsx
    │   │   └── OutstandingDuesScreen.tsx
    │   ├── products/
    │   │   ├── ProductsScreen.tsx
    │   │   └── ProductDetailScreen.tsx
    │   ├── sales/
    │   │   ├── SalesScreen.tsx
    │   │   └── SaleDetailScreen.tsx
    │   ├── day-session/
    │   │   └── DaySessionScreen.tsx
    │   ├── customers/
    │   │   ├── CustomersScreen.tsx
    │   │   └── CustomerDetailScreen.tsx
    │   └── settings/
    │       └── SettingsScreen.tsx
    │
    ├── navigation/               ← React Navigation setup
    │                                - RootNavigator.tsx       (guards on auth)
    │                                - MainTabs.tsx            (bottom tabs)
    │                                - BillingStack.tsx        (per-tab stacks)
    │                                - types.ts                (route param types)
    │
    ├── stores/                   ← Zustand state (ported from desktop)
    │                                - auth-store.ts
    │                                - ui-store.ts
    │                                - held-bills-store.ts     (localStorage → AsyncStorage)
    │
    ├── types/                    ← shared TypeScript interfaces
    │                                (auth, product, sale, etc.)
    │
    ├── lib/                      ← platform-agnostic utilities
    │                                - storage.ts              (AsyncStorage wrapper)
    │                                - money.ts                (formatters)
    │                                - jwt.ts                  (exp decode)
    │                                - offline-bills.ts        (RN version)
    │
    ├── hooks/                    ← custom React hooks
    │                                - useDebounce.ts
    │                                - useOnline.ts            (RN NetInfo)
    │
    ├── constants/                ← design tokens + config
    │                                - theme.ts                (colors, spacing)
    │                                - env.ts                  (API_BASE_URL, etc.)
    │
    └── assets/                   ← in-code images / icons imported by src
```

**Convention:**
- `screens/` = one folder per feature area, PascalCase file per screen
- Every file exports one main React component + colocated helpers
- Business logic lives in `lib/`, not inside components
- Data-fetching hooks live in `hooks/` or inline in the screen (React Query)

---

## Bootstrapping (when ready to start coding)

Run **from inside this folder**:

```bash
# 1. Initialise Expo into this scaffold (keeps our src/ untouched, adds
#    package.json, tsconfig.json, app.json, babel.config.js, App.tsx)
cd "C:\Users\singh\Desktop\Retail OS\mobile"
npx create-expo-app@latest . --template blank-typescript

# 2. Core dependencies (matches what the desktop app uses)
npm install \
  zustand \
  @tanstack/react-query \
  @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs \
  react-native-screens react-native-safe-area-context \
  @react-native-async-storage/async-storage \
  lucide-react-native \
  react-native-svg

# 3. NativeWind (Tailwind for React Native — same class names as desktop)
npm install nativewind
npm install --save-dev tailwindcss@3.3.2

# 4. Native features we'll need
npx expo install expo-barcode-scanner expo-camera expo-print expo-sharing

# 5. First run (Android device or emulator required)
npx expo start
```

## What ports 100% from the desktop app

| desktop file / concept | mobile equivalent |
|---|---|
| `desktop/src/lib/api.ts` | `mobile/src/api/api.ts` (identical — fetch works on RN) |
| `desktop/src/lib/*-api.ts` | `mobile/src/api/*-api.ts` (copy verbatim) |
| `desktop/src/stores/auth-store.ts` | `mobile/src/stores/auth-store.ts` (swap `localStorage` for `AsyncStorage`) |
| `desktop/src/types/*` | `mobile/src/types/*` (copy verbatim) |
| TanStack Query patterns | works identically on RN |
| Zustand patterns | works identically on RN |
| Business logic (`computeTotals`, currency formatters) | copy verbatim |

## What has to be rewritten

| desktop | mobile |
|---|---|
| `<div>` / `<span>` / `<button>` | `<View>` / `<Text>` / `<Pressable>` |
| `className="bg-ink-900 text-slate-200"` | Same, via NativeWind |
| `react-router-dom` | `@react-navigation/native` |
| `lucide-react` | `lucide-react-native` (same API) |
| `localStorage` | `AsyncStorage` (via `mobile/src/lib/storage.ts` wrapper) |
| Framer Motion | Reanimated (later, if we need animations) |
| Keyboard shortcuts (F2/F7/etc.) | Not applicable — use bottom-nav + gestures |

---

## Environment

Reads from `.env` (created by Expo). One variable needed to point at the
Render backend — same URL as the desktop `.env.production`:

```
EXPO_PUBLIC_API_BASE_URL=https://retailos-backend-8jwi.onrender.com
```

Read in code via `process.env.EXPO_PUBLIC_API_BASE_URL`.

---

## Longer-term (optional): monorepo restructure

Right now `mobile/`, `desktop/`, and `backend/` are three sibling folders.
If we start actually shipping both apps and copying API changes twice
becomes painful, we can promote the shared bits to a proper monorepo:

```
Retail OS/
├── backend/
├── apps/
│   ├── desktop/
│   └── mobile/
└── packages/
    └── core/          ← api, stores, types, business logic (imported by both apps)
```

This is a 1-day mechanical change (npm workspaces + move + update imports),
zero user-visible effect. Deferred until we have both apps in active use.

---

## First-target features (Phase 1 — Mobile POS)

Order of build once Expo is initialised:

1. Login (auth-store + LoginScreen)
2. Root navigator with tabs: New Bill | Sales | Products | Settings
3. Products list with barcode-scanner search (`expo-barcode-scanner`)
4. New Bill screen (cart + checkout + hold-bill)
5. Day Session open/close
6. Sales list + invoice detail
7. Offline bill queue with AsyncStorage
8. Bluetooth thermal printer (58/80mm) — deferred phase 2

Each screen is one PR against the desktop app's behaviour as reference.
