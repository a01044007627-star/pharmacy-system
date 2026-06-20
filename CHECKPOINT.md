# Pharmacy System — Comprehensive Checkpoint

> **Generated:** 2026-06-20  
> **Project:** Logixa Pharmacy Management System  
> **Root:** `D:\projects\work\project-pharmacy\pharmacy-system`  
> **Latest Commit:** `1fabdbb` — "feat: implement notification system, developer control plane, and backend infrastructure for sales, inventory, and PWA synchronization."

---

## 1. Project Identity

| Attribute | Value |
|-----------|-------|
| **Name** | pharmacy-system |
| **Version** | 1.0.0 |
| **Architecture** | Next.js 16.2 + Supabase + TypeScript + shadcn/ui (backed by `@base-ui/react` ^1.5.0) |
| **Package Manager** | pnpm 10.12.1 |
| **Node** | 20.x |
| **Styling** | Tailwind CSS v4.3 + `tw-animate-css` |
| **State / Fetching** | `@tanstack/react-query` ^5.101, `@tanstack/react-table` ^8.21 |
| **Form** | react-hook-form ^7.79 + `@hookform/resolvers` ^5.4 + zod ^4.4 |
| **Charts** | recharts ^2.15 |
| **Offline** | `idb` + Service Worker (serwist) + `sql.js` |
| **CI** | `npx tsc --noEmit` = 0 errors; `npm run lint` clean |
| **Test** | Jest 30 with `ts-jest` |

**Key directories:**

```
src/app/
  api/            — 28 API route groups (accounts, auth, crm, dashboard, developer, inventory, sales, sync, …)
  auth/           — login, signup, forgot-password, reset-password
  dashboard/      — 23 page groups (accounts, crm, inventory, sales, purchases, hr, reports, …)
  developer/      — layout.tsx + page.tsx → DeveloperControlPlaneView
  offline/        — PWA offline page
src/features/
  21 feature modules (accounting, auth, calculator, cashier, controlled-drugs, crm, dashboard-home, developer, expenses, hr, inventory, notifications, partners, profile, purchases, reports, sales, settings, sync, users)
src/components/ui/
  51 shadcn-style components built on @base-ui/react (NOT Radix)
src/lib/
  auth/           — session, permissions, server-permissions
  developer/      — server.ts (requireDeveloperControlPlane, writeDeveloperAudit)
  supabase/       — admin.ts, client.ts, middleware.ts
  pwa/            — offline / sync utilities
  sync/           — IndexedDB mutation queue + SyncManager
  audit/          — audit-event helpers
src/contexts/
  auth-context.tsx, branch-context.tsx, notification-context.tsx, settings-context.tsx
```

---

## 2. Database Status

| Metric | Value |
|--------|-------|
| **SQL files total** | 47 (6 consolidated + 41 migration files) |
| **CREATE TABLE statements** | 225 (including IF NOT EXISTS variants) |
| **CREATE FUNCTION statements** | 121 |
| **Consolidated baseline** | `supabase/consolidated/000–005` (~1017 lines each, idempotent) |
| **Migration layer** | `supabase/migrations/20260617*` through `20260620*` |
| **deploy.sql** | `supabase/deploy.sql` — 761 KB (760,955 bytes), concatenated from all 47 files |
| **deploy.ps1** | `supabase/deploy.ps1` — Builds deploy.sql; supports `-Paste` (web editor) or `-PGString` (psql) |
| **Last deployment** | All 47 files ran successfully via deploy.sql |
| **Idempotency** | All DDL uses `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP IF EXISTS` |

### Consolidated Files

| File | Lines | Purpose |
|------|-------|---------|
| `000_core_tables.sql` | 2,051 | Core tables (pharmacies, branches, items, sales, inventory, …) with `ADD COLUMN IF NOT EXISTS` |
| `001_helper_functions.sql` | 1,017 | Auth helpers (`is_developer`, `is_pharmacy_owner`, `has_pharmacy_access`, `get_user_active_pharmacy_id`), permission helpers, setting helpers, triggers, notifications |
| `002_atomic_rpcs.sql` | 2,196 | All RPC functions (cashier sales v2, sales returns, purchases, purchase returns, FEFO, …) |
| `003_rls_policies.sql` | — | Row-Level Security policies |
| `004_triggers_views_constraints.sql` | — | Triggers, views, constraints |
| `005_data_migrations.sql` | — | Seed / data migration scripts |

### Migration Files (41 total)

Organized by date prefix:
- **20260617*** — 13 files (initial schema, auth, RBAC, tenancy, notifications, settings, users, permissions, owner/employee/developer tables)
- **20260618*** — 18 files (cashier sales atomic, operation-level RLS, owner workspace bootstrap, cashier FEFO, sales returns, received purchases, schema integrity, purchase returns, tasks, operational P0/P2/P3 fixes, item units/suppliers, legacy cleanup, final conflicts)
- **20260619*** — 6 files (performance indexes, items cycle integrity, catalog RPC, operational linking, catalog loading perf, pharmacy specialization)
- **20260620*** — 5 files (cashier coupon integration, controlled drugs register, developer control plane, report perf aggregations, perf indexes & constraints)

---

## 3. All Fixes Made

### 3.1 `max_branches` column missing (`000_core_tables.sql`)

**File:** `supabase/consolidated/000_core_tables.sql:42`  
**Issue:** Some environments lacked the `max_branches` / `max_users` columns on `pharmacies`  
**Fix:** Added `ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS max_branches INTEGER NOT NULL DEFAULT 3` and matching for `max_users` (line 43). Also added `pharmacies_limits_check` constraint (line 49).

### 3.2 `p_lines` default value in `create_cashier_sale_v2` (`002_atomic_rpcs.sql`)

**Files:**
- `supabase/migrations/20260618001000_atomic_cashier_sales.sql:24` — original signature had `p_lines JSONB` (no default)
- `supabase/consolidated/002_atomic_rpcs.sql:336` — fixed to `p_lines JSONB DEFAULT NULL`

**Issue:** Calling `create_cashier_sale_v2` without lines caused a null parameter error  
**Fix:** Changed parameter to `DEFAULT NULL` and added `IF p_lines IS NULL OR …` guard at line 426

### 3.3 `ENABLE ROW LEVEL SECURITY` on views (`20260617001000`)

**File:** `supabase/migrations/20260617001000_auth_rbac_tenancy_hardening.sql:355,413`  
**Issue:** Dynamic SQL tried `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on views, which fails  
**Fix:** Added `AND t.table_type = 'BASE TABLE'` filter to both `information_schema` queries (lines 355 and 413), skipping views

### 3.4 `task_tenant_select` policy already exists (`20260618010000`)

**File:** `supabase/migrations/20260618010000_tasks_table_import_stock_approval.sql:31`  
**Issue:** Re-running migrations would fail when `CREATE POLICY task_tenant_select` was already defined  
**Fix:** Added `DROP POLICY IF EXISTS task_tenant_select ON public.pharmacy_tasks` (and matching DROP for insert/update/delete) before each `CREATE POLICY` (lines 31–34)

### 3.5 `get_user_active_pharmacy_id()` function not found

**File:** `supabase/consolidated/001_helper_functions.sql:1001`  
**Issue:** Some code paths called `get_user_active_pharmacy_id()` which didn't exist  
**Fix:** Created the function (lines 1001–1014) that returns the `pharmacy_id` from `pharmacy_profiles` where `is_active = true`, ordered by `last_login_at DESC`. Grants: `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE TO authenticated`.

### 3.6 Refactored `developer-shell.tsx` — shadcn migration

**File:** `src/features/developer/components/developer-shell.tsx`  
**Issue:** Used raw `<nav>` HTML; needed proper shadcn component usage  
**Fix:** Replaced with `NavigationMenu`, `NavigationMenuItem`, `NavigationMenuLink`, `NavigationMenuList` from `@/components/ui/navigation-menu` and `Separator` from `@/components/ui/separator`

### 3.7 Refactored `developer-control-plane-view.tsx` — full shadcn migration

**File:** `src/features/developer/components/developer-control-plane-view.tsx` (1,030 lines)  
**Issue:** Mixed raw HTML with shadcn components  
**Fix:** Component lineup now uses:
- `Card`, `CardContent`, `CardDescription`, `CardHeader`, `CardTitle` — cards
- `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow` — data table
- `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` — dropdowns
- `Sheet`, `SheetClose`, `SheetContent`, `SheetDescription`, `SheetFooter`, `SheetHeader`, `SheetTitle`, `SheetTrigger` — slide-over panels
- `Progress`, `ProgressIndicator`, `ProgressTrack` — usage bars
- `Skeleton` — loading state
- `Alert`, `AlertDescription`, `AlertTitle` — warning/info boxes
- `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger` — tooltips
- `ScrollArea` — scrollable containers
- `Separator` — dividers
- `Empty`, `EmptyContent`, `EmptyDescription`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle` — empty states

---

## 4. Git History (recent 25 commits)

```
1fabdbb feat: implement notification system, developer control plane, and backend
bc260e3 security: stop tracking local environment secrets
28f5338 feat: implement core inventory, sales, and task management API routes
21cbe3f feat: implement responsive dashboard sidebar with role-based navigation
934e2e7 refactor: remove deprecated legacy authentication module
eda651a feat: implement offline-first PWA architecture
4490499 feat: implement full-stack CRM, inventory, PWA sync infrastructure
d856701 feat: add environment configuration, update .gitignore
e693466 feat: implement inventory management system
34fb685 feat: inventory items list view with advanced filtering
d026b0f feat: inventory management module with paginated item API
e8bc3a4 feat: server-side product import with unit normalization
60e2eb2 refactor: extract Code128 encoder to dedicated lib
9848289 fix: replace jsbarcode with zero-dependency Code128-B SVG renderer
1b88147 feat: inventory API route, barcode printing views
dbf701c feat: bulk pharmacy item import and price update API
d965eaf feat: inventory items with variants, warranties, stock movement
fd739cc fix(build): match serwist dependency specifier with lockfile
9b83089 fix(build): sync pnpm-lock.yaml with package.json
d940eb8 cleanup: remove temporary file
2f9c1ab fix(build): add missing serwist dependency
6128a0d chore: add serwist package to deps
ae77dca fix(select): resolve english values on trigger, correct RTL alignment
9158969 feat: add NativeSelect component wrapper
62697c8 feat: add NativeSelect component wrapper (duplicate)
```

---

## 5. File Tree (Key Directories)

### `src/app/` (top level)
```
src/app/
├── api/           accounts, audit-events, auth, controlled-drugs, crm, dashboard,
│                  deleted-records, developer, expenses, health, hr, inventory,
│                  items, loyalty, notifications, partners, pharmacies, platform,
│                  prescriptions, profile, purchases, reports, sales, settings,
│                  sync, tasks, uploadthing
├── auth/          forgot-password, login, reset-password, signup + layout.tsx
├── dashboard/     23 sub-routes (accounts..users) + layout.tsx + page.tsx
├── developer/     layout.tsx → <DeveloperShell>, page.tsx → <DeveloperControlPlaneView>
├── offline/       page.tsx (PWA offline fallback)
├── error.tsx, global-error.tsx, globals.css, layout.tsx, loading.tsx, not-found.tsx, page.tsx
```

### `src/features/developer/` (Control Plane)
```
src/features/developer/
├── components/
│   ├── developer-shell.tsx                — Shell layout (NavigationMenu-based header)
│   └── developer-control-plane-view.tsx   — 1030-line main view (5 tabs)
├── control-plane.ts                       — Types, validators (parsePharmacyLifecycleUpdate,
│                                            normalizeFeatureFlagName, safeDeveloperAction,
│                                            isFeatureFlagEnabled)
└── control-plane.test.ts                  — 8 unit tests
```

### `src/components/ui/` (51 components)
```
accordion, alert-dialog, alert, avatar, badge, breadcrumb, button-group, button,
calendar, card, chart, checkbox, collapsible, combobox, command, context-menu,
data-table, date-picker, dialog, direction, drawer, dropdown-menu, empty, form,
hover-card, input-group, input, kbd, label, menubar, native-select, navigation-menu,
pagination, popover, progress, radio-group, scroll-area, select, separator, sheet,
skeleton, slider, sonner, switch, table, tabs, textarea, toggle-group, toggle, tooltip
```

### `supabase/`
```
supabase/
├── consolidated/    6 files (000–005)
├── migrations/      41 files (20260617* – 20260620*)
├── deploy.ps1       Script to build & optionally run deploy.sql
├── deploy.sql       761 KB — concatenation of all 47 SQL files
```

---

## 6. Key Decisions & Conventions

### UI / Theming
- **Arabic RTL interface** — `dir="rtl"` on root + developer shell
- **Dark theme** — `bg-slate-950` background, `border-white/10` borders, `cyan-400` accent, `text-slate-100` foreground
- **shadcn/ui from `@base-ui/react`** — all 51 components are built on `@base-ui/react` (NOT Radix). Select uses `@base-ui/react/select`, etc.
- **No `asChild` prop** — `@base-ui/react` uses `render` prop instead (see `SheetTrigger render={<Button />}` pattern)
- **Select `onValueChange`** passes `string | null` — handlers must coerce with `??` fallback

### Database
- **Consolidated SQL = baseline** — files `000–005` represent the final idempotent schema
- **Migrations = layer on top** — chronological `20260617*` through `20260620*`
- **All DDL idempotent** — `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`
- **Tenant isolation via `pharmacy_id`** — every data table has `pharmacy_id`; RLS uses `has_pharmacy_access(pharmacy_id)` helper

### Auth / Security
- **RLS bypass** — Developer Control Plane uses `service_role_key` with server-side permission checks (`requireDeveloperControlPlane` in `src/lib/developer/server.ts`)
- **Developer gate** — `/developer` route gated by `auth.isDeveloper`; server API verified via `developer_users` table + `SUPABASE_SERVICE_ROLE_KEY`
- **Audit trail** — every developer action logged to `developer_audit_events` via `writeDeveloperAudit()`

### Offline Architecture
- **Service Worker** — serwist-based, caches static assets + API responses
- **IndexedDB** — `idb` wrapper for local storage
- **Mutation queue** — queued writes synced when online via `SyncManager`
- **`sql.js`** — local SQLite-like query engine for offline reads

### Feature Flags
- Table `developer_feature_flags` — name, description, enabled, conditions (JSONB)
- `isFeatureFlagEnabled()` in `control-plane.ts:88` — evaluates pharmacy_ids, exclude_pharmacy_ids, plans

---

## 7. Developer Control Plane Architecture

### Route Structure
- **Route:** `/developer` — separate from `/dashboard`
- **Layout:** `src/app/developer/layout.tsx` → `DeveloperShell` (`src/features/developer/components/developer-shell.tsx`)
- **Page:** `src/app/developer/page.tsx` → `DeveloperControlPlaneView` (`src/features/developer/components/developer-control-plane-view.tsx`, 1,030 lines)
- **API:** `src/app/api/developer/control-plane/route.ts` (267 lines) — GET (read all data) + POST (actions)

### Shell Features (`developer-shell.tsx`)
- Sticky header with Logixa Control Plane branding
- `NavigationMenu` with links: مركز التحكم, العملاء, المنصة
- Refresh + Sign Out buttons
- Auth guard: redirects non-developers to `/dashboard`

### Control Plane View — 5 Tabs

| Tab | ID | Content |
|-----|-----|---------|
| **العملاء** | `clients` | Pharmacy table (searchable, sortable), inline detail panel (right card), Sheet overlay (from Manage button), Onboarding Sheet (new client creation) |
| **المزايا** | `platform` | Feature flag CRUD — Add form (left card), grid of existing flags with toggle |
| **الإصدارات** | `releases` | Release publishing — form (left card), release history list with version, changelog, required/active badges |
| **الصحة** | `health` | Environment info, health checks grid, error events with resolve action |
| **التدقيق** | `audit` | Open support sessions alert + audit event timeline |

### API Endpoints — POST Actions

| Action | Handler | Description |
|--------|---------|-------------|
| `onboard_client` | line 92 | Creates auth user + pharmacy + main branch + profiles |
| `update_pharmacy` | line 167 | Updates lifecycle fields (status, plan, limits, notes) |
| `upsert_feature_flag` | line 182 | Creates/updates feature flag by name |
| `resolve_error` | line 197 | Marks error event as resolved |
| `publish_release` | line 207 | Inserts new release version |
| `start_support_session` | line 227 | Opens impersonation session + sets cookie |
| `end_support_session` | line 243 | Closes active support session |
| `record_health_check` | line 252 | Inserts health check record |

### Pharmacy Lifecycle Management
- **2 edit paths:** Inline Card panel (right side of clients tab) + Sheet overlay (triggered from "إدارة" button in table)
- **Editable fields:** status (active/suspended/closed), plan (trial/starter/professional/enterprise), trial_ends_at, subscription_ends_at, max_branches, max_users, developer_notes
- **Validators:** `parsePharmacyLifecycleUpdate()` in `control-plane.ts:36` — validates statuses, plans, limits, dates

### Validation & Business Logic (`control-plane.ts`)
- `PLATFORM_PLANS`: `["trial", "starter", "professional", "enterprise"]`
- `PHARMACY_STATUSES`: `["active", "suspended", "closed"]`
- `normalizeFeatureFlagName()` — lowercases, replaces spaces with `_`, validates pattern
- `safeDeveloperAction()` — whitelist of 8 allowed actions
- `isFeatureFlagEnabled()` — evaluates pharmacy_id scoping, plan filtering, exclusions

---

## 8. CI / TypeScript

- **Last verified:** `npx tsc --noEmit` = 0 errors
- **Lint:** `npm run lint` passes
- **Tests:** `npm run test` — Jest with `ts-jest`, includes 8 unit tests for `control-plane.ts`

---

## 9. Deployment

### deploy.sql (761 KB)
- **Path:** `supabase/deploy.sql`
- **Contents:** Concatenation of all 6 consolidated files + all 41 migration files
- **Generated by:** `supabase/deploy.ps1`

### deploy.ps1
- **Path:** `supabase/deploy.ps1` (47 lines)
- **Usage:**
  - `.\deploy.ps1 -Paste` — outputs instructions for Supabase SQL Editor
  - `.\deploy.ps1 'postgresql://postgres:password@host:5432/postgres'` — runs via psql directly
- **Behavior:** Collects consolidated files (in order 000–005) + all migration files (sorted by name), concatenates with filename headers into `deploy.sql`, then optionally pastes/runs

---

## 10. AGENTS.md Context

**File:** `C:\Users\Logixa\.config\opencode\AGENTS.md` (258 lines)

Contains detailed persona configuration for the AI assistant:

- **Persona:** "جيجي" — a skilled developer ("لبوة الصقر"), loyal servant to "الصقر" (Mostafa, mostafa0falcon@gmail.com)
- **Technical context:** Flutter + Clean Architecture prior experience; now working on Next.js + Supabase + TypeScript stack
- **Work ethic:** Blind obedience + technical excellence + zero errors
- **Preferences:** Arabic Egyptian dialect, dark theme, shadcn/ui, atomic design patterns, thorough error handling
- **Credentials:** Email `mostafa0falcon@gmail.com`, all project infrastructure owned by الصقر

---

## Appendix: Key File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/features/developer/components/developer-shell.tsx` | 86 | Developer shell layout with NavigationMenu |
| `src/features/developer/components/developer-control-plane-view.tsx` | 1,030 | Full 5-tab control plane UI |
| `src/features/developer/control-plane.ts` | 102 | Types, validators, feature flag evaluator |
| `src/features/developer/control-plane.test.ts` | 75 | Unit tests for control-plane.ts |
| `src/app/api/developer/control-plane/route.ts` | 267 | GET + POST API handler |
| `src/lib/developer/server.ts` | 50 | Server helpers (requireDeveloperControlPlane, writeDeveloperAudit) |
| `supabase/deploy.ps1` | 47 | Deployment script |
| `supabase/deploy.sql` | 761 KB | Consolidated deployable SQL |
| `supabase/consolidated/000_core_tables.sql` | 2,051 | Core tables schema |
| `supabase/consolidated/001_helper_functions.sql` | 1,017 | Helper functions (incl. get_user_active_pharmacy_id) |
| `supabase/consolidated/002_atomic_rpcs.sql` | 2,196 | All atomic RPC functions |
| `supabase/migrations/20260617001000_auth_rbac_tenancy_hardening.sql` | 494 | RLS hardening + table_type fix |
| `supabase/migrations/20260618010000_tasks_table_import_stock_approval.sql` | 129 | Tasks table + policy DROP fix |
| `supabase/migrations/20260620002000_developer_control_plane.sql` | — | Control plane DB objects |
