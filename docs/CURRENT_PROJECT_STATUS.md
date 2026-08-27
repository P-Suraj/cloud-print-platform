# AutoPrint Current Project Status and AI Handoff

**Status date:** 27 August 2026  
**Repository root:** `F:\Projects\Printer automation`  
**Primary pilot shop:** `CANARY01`  
**Purpose:** Give a context-free engineer or AI model an accurate starting point without relying on prior conversations.

> Security warning: never copy credentials into this document. Runtime secrets are stored in local `.env` files and in Supabase. Do not print or commit them. The demo login password is intentionally not recorded here.

## 1. Executive status

AutoPrint currently contains two related application generations:

1. The original/legacy application, including a feature-rich customer print studio and shop-management pages.
2. The v3 rebuild, which implements the Milestone 0/Milestone 1 PDF vertical slice with stronger authentication, capability-based customer access, immutable quotes, preparation workers, device enrollment, leases/fencing, a Windows-agent journal, and explicit uncertain-outcome handling.

The v3 vertical slice is live against the configured Supabase project and passed an HTTP end-to-end smoke test. The browser UI is deployed to Vercel production (see Section 2). The Windows agent code and automated tests are present, but a real physical printer has not yet been certified. Never represent a test job as physically printed unless spooler/printer evidence exists.

The feature-parity restoration currently exposes the existing shop-management modules from the v3 navigation and links the v3 customer page to the full legacy print studio. This makes the earlier features accessible, but it is a compatibility bridge, not a completed security migration of every legacy feature to v3 APIs. See **Known limitations and risks**.

## 2. Live/local endpoints

### Production (Vercel — deployed 27 August 2026)

- Frontend: `https://frontend-flame-theta-51.vercel.app`
- Customer v3 flow: `https://frontend-flame-theta-51.vercel.app/v3/print/CANARY01`
- Shop login: `https://frontend-flame-theta-51.vercel.app/v3/console/login`
- Shop v3 queue: `https://frontend-flame-theta-51.vercel.app/v3/console/queue`
- API: `https://autoprint-api.vercel.app`
- API health: `https://autoprint-api.vercel.app/health/live` — returns `{"status":"live","contract_version":3}`
- API readiness: `https://autoprint-api.vercel.app/health/ready` — returns `{"status":"ready","database":"ok","storage":"ok"}`
- API documentation: `https://autoprint-api.vercel.app/docs`
- Vercel project (API): `zodiacsuraj-5177s-projects/autoprint-api`
- Vercel project (frontend): `zodiacsuraj-5177s-projects/frontend`

Production smoke test on 27 August 2026: all six checks passed (health/live 200, health/ready 200, frontend root 200, /v3/console/login 200, /v3/console/queue 200, unauthenticated queue API 401). Production API URL is baked into the JS bundle; no localhost references present.

`QUEUE_ESTIMATES_ENABLED=false` and `ENVIRONMENT=production` are set server-side. Payments, wallet, ETA estimates and Express priority are not enabled.

### Local development

When the local services are running:

- Customer v3 flow: `http://localhost:5173/v3/print/CANARY01`
- Full feature-rich customer studio: `http://localhost:5173/kiosk/CANARY01`
- Shop login: `http://localhost:5173/v3/console/login`
- Shop v3 queue: `http://localhost:5173/v3/console/queue`
- API health: `http://127.0.0.1:8000/health/live`
- API readiness: `http://127.0.0.1:8000/health/ready`
- API documentation: `http://127.0.0.1:8000/docs`

At the time this document was written, the frontend returned HTTP 200 and the API reported `ready` with database and storage connectivity.

## 3. Repository layout

### Frontend

- `frontend/src/App.jsx` — route registration and legacy/v3 application split.
- `frontend/src/pages/v3/CustomerPrint.jsx` — secure v3 PDF upload, preparation polling, quote and acceptance UI.
- `frontend/src/pages/v3/CustomerStatus.jsx` — capability-protected live order status.
- `frontend/src/pages/v3/ShopLogin.jsx` — Supabase Auth login through the v3 API.
- `frontend/src/pages/v3/ShopQueue.jsx` — authenticated shop queue and approve/reject actions.
- `frontend/src/pages/v3/ShopJob.jsx` — job detail, preview and uncertain-outcome resolution.
- `frontend/src/pages/v3/V3Layout.jsx` — v3 shell and management navigation.
- `frontend/src/services/v3Api.js` — v3 browser transport; sends contract version `3` and cookies.
- `frontend/src/pages/Home.jsx` — original full customer studio.
- `frontend/src/pages/DashboardOverview.jsx`, `JobBoard.jsx`, `Customers.jsx`, `Files.jsx`, `Payments.jsx`, `ShopLedger.jsx`, `ShopRates.jsx` — original shop-management modules now routed from the v3 console as a compatibility layer.

### v3 API and workers

- `services/api/app/main.py` — FastAPI application, CORS, contract middleware, health endpoints and routers.
- `services/api/app/routes/` — auth, orders, uploads, quotes, customer status, shop jobs, devices and agent endpoints.
- `services/api/app/auth.py` — opaque server sessions and CSRF verification.
- `services/api/app/capabilities.py` — customer order capability tokens.
- `services/api/app/pricing.py` — deterministic rate-card pricing, including selected page-range pricing.
- `services/api/app/pdf_validation.py` — bounded PDF validation.
- `services/api/worker/preparation.py` — claims preparation tasks, downloads and validates source PDFs, and creates immutable artifacts.
- `services/api/worker/cleanup.py` — retention-aware storage cleanup.
- `services/api/migrations/` — tracked v3 PostgreSQL migrations.

### Windows agent

- `windows-agent/agent.py` — main agent entry and legacy/v3 dispatch integration.
- `windows-agent/v3_agent_runner.py` — claim, verify, journal, print, observe spooler and report outcome.
- `windows-agent/v3_api_client.py` — v3 agent API transport.
- `windows-agent/v3_device_credentials.py` — device credential persistence.
- `windows-agent/v3_enrollment_client.py` — enrollment client.
- `windows-agent/attempt_journal.py` — local SQLite attempt journal and restart recovery.
- `windows-agent/print_executor.py` — SumatraPDF print command construction.
- `windows-agent/spikes/spooler_correlation_spike.py` — runnable spooler-correlation field spike.

## 4. Implemented v3 workflow

The verified vertical slice is:

1. Customer opens a new order for `CANARY01`.
2. API returns an opaque capability token; only its hash is stored server-side.
3. Browser requests a signed upload intent and uploads a PDF directly to Supabase Storage.
4. Browser finalizes the upload.
5. Preparation worker claims the task, downloads the actual object, performs bounded PDF validation, calculates page count, uploads an immutable artifact and marks the order ready.
6. API prices the requested options against the active versioned rate card and stores an immutable quote snapshot.
7. Quote acceptance uses an idempotency key and creates one print job.
8. Authenticated shop owner/staff approves or rejects the job.
9. An enrolled active device claims the next approved job with a lease and fencing token.
10. Agent downloads the signed artifact, verifies SHA-256, records journal states, renews the lease, invokes SumatraPDF and observes the Windows spooler.
11. The agent reports `completed` only with permitted completion evidence. Ambiguous results become `needs_attention` and require operator resolution.

## 5. Database and migration state

The v3 schema is `autoprint_v3`. Forward migrations currently registered by `services/api/migrations/run_migrations.py` are:

- `0000_preflight_inventory.sql`
- `0001_v3_types_and_core.sql`
- `0002_v3_constraints_indexes.sql`
- `0003_v3_roles_grants_rls.sql`
- `0004_v3_canary_backfill.sql`
- `0005_v3_state_machine.sql`
- `0006_v3_transaction_functions.sql`
- `0007_v3_canary_cutover.sql`
- `0009_v3_postgrest_exposure.sql`
- `0010_v3_postgrest_schema_reload.sql`
- `0011_v3_crypto_search_path.sql`
- `0012_fix_claim_transition_validation.sql`

`0008_v3_canary_rollback.sql` is an explicit rollback and is not a forward migration.

Important live corrections:

- PostgREST was configured to expose `autoprint_v3`.
- PostgREST schema reload notifications were added.
- security-definer crypto calls use the Supabase `extensions` schema.
- Migration `0012` removes accidentally misplaced transition-validation code from `claim_next_print_job` and installs it in `advance_print_attempt`.
- The existing pilot shop was promoted from code `TST001` to `CANARY01` in place, retaining UUID `11111111-1111-4111-8111-111111111111` and its configuration/history.

Run migrations from `services/api` after loading the local environment:

```powershell
.\.venv\Scripts\python.exe migrations\run_migrations.py
.\.venv\Scripts\python.exe migrations\run_migrations.py --status
```

Schema verification SQL is `services/api/migrations/verify_v3_schema.sql`.

## 6. Authentication and keys

- Shop users authenticate through Supabase Auth, but the application creates its own opaque `autoprint_session` HttpOnly cookie and CSRF token.
- Local development cookies are not marked `Secure`; production cookies are.
- Customer status and customer mutations require an order capability token.
- Devices authenticate using an enrolled device ID plus a high-entropy device secret; only hashes are stored.
- The browser uses a publishable/anonymous Supabase key only.
- The trusted API/worker runtime uses the configured secret key server-side.
- Current Supabase opaque `sb_secret_...` keys are supported by the installed `supabase==2.31.0` client.
- Custom API/worker role JWT configuration remains in the model for a future environment with valid signing keys. The current trusted-server fallback still enforces application authorization and fencing rules but is broader at the database gateway than ideal least privilege.
- A persistent demo owner account exists for manual testing. Retrieve/reset its password through the authorized operator workflow; do not add it to source control.

## 7. Customer-side status

### Secure v3 customer page

Implemented and working:

- PDF-only validation with a 25 MB browser limit.
- Secure signed upload.
- Preparation status polling.
- Copies, B&W/color and duplex options.
- Advanced page range, A4/A3/Legal paper size, auto/portrait/landscape orientation and fit/shrink/actual-size scaling.
- Exact immutable quote and explicit confirmation.
- Capability-protected live status page.
- Page-range pricing counts unique selected pages and rejects malformed/out-of-document ranges.

### Full print studio compatibility route

The v3 page links to `/kiosk/CANARY01`, which exposes the previous customer features including multiple-file handling, document/photo modes, preview controls, labels, photo grids, pages-per-sheet and advanced layout controls.

This full studio still uses the legacy data path. Do not assume its submissions have all v3 guarantees until each feature is migrated to preparation artifacts and v3 quote/job contracts.

## 8. Shopkeeper-side status

After a successful v3 login, the console exposes:

- Overview/dashboard metrics.
- Production Kanban/manual jobs.
- Secure v3 print queue.
- Customer directory.
- File archive and reprint controls.
- Payments/accounts receivable.
- Customer ledger.
- Rate settings.

The v3 queue, job detail, approval/rejection and uncertain resolution use authenticated v3 APIs. The other management modules are routed legacy modules that currently query legacy public tables through the browser Supabase client. Their required live tables (`shops`, `jobs`, `customers`, `payments`, `print_jobs`) were verified present by `services/api/scripts/verify_legacy_feature_tables.py`.

Treat this as feature availability, not final secure backend parity. The management modules need server-side v3 endpoints and removal of the old local-storage UI gate before production rollout.

## 9. Automated and live verification evidence

Most recent results at the time of this document:

- API unit/integration tests: **42 run, all passed, 1 live-only test skipped when its environment flag was absent**.
- Windows-agent tests: **9 passed**.
- Frontend tests: **4 passed**.
- Frontend Vite production build: **passed**.
- Live customer pipeline smoke: **passed**.
- Live HTTP vertical slice: **`LIVE_VERTICAL_SLICE=PASS`**.
- API `/health/ready`: **ready**.
- Customer UI: **HTTP 200**.
- Legacy feature-table compatibility check: **pass**.

Commands:

```powershell
# API
cd "F:\Projects\Printer automation\services\api"
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

# Windows agent
cd "F:\Projects\Printer automation\windows-agent"
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

# Frontend
cd "F:\Projects\Printer automation\frontend"
npm test -- --run
npm run build
```

Live scripts require the configured local environment and intentionally create audit test data:

- `services/api/scripts/live_customer_smoke.py`
- `services/api/scripts/live_vertical_smoke.py`
- `services/api/scripts/verify_legacy_feature_tables.py`

The vertical smoke script never claims that paper was printed. It reports a no-paper test outcome and exercises manual resolution.

## 10. Running the local stack

The exact local environment files are intentionally not documented. Required settings are described by:

- `services/api/.env.example`
- `frontend/.env.example`
- `windows-agent/config.json.example`

Typical commands:

```powershell
# Terminal 1: API (load services/api/.env into the process first)
cd "F:\Projects\Printer automation\services\api"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: preparation worker (load the same environment first)
cd "F:\Projects\Printer automation\services\api"
.\.venv\Scripts\python.exe -m worker.preparation

# Terminal 3: frontend
cd "F:\Projects\Printer automation\frontend"
npm run dev
```

Before debugging UI errors, verify both `/health/live` and `/health/ready`. A browser `Failed to fetch` error normally means the API is stopped, its origin is missing from CORS, or the configured API base is incorrect.

## 11. Notable fixes already made

- Rebuilt the v3 customer, status and console visual design.
- Removed hardcoded localhost transport URLs from v3 page logic; Vite development proxy/environment configuration controls transport.
- Prevented legacy global header/help/footer from wrapping v3 routes.
- Added friendly network failure messages.
- Added safe local-development cookie behavior.
- Upgraded Supabase Python dependencies to current opaque-key-compatible versions.
- Added trusted runtime handling for opaque Supabase secret keys while keeping them out of the browser.
- Applied all v3 schema, PostgREST and crypto-search-path migrations.
- Fixed the live agent claim RPC transition-validation defect.
- Made repeated live smoke tests reconcile only known smoke-test documents and never arbitrary customer jobs.
- Added selected-page pricing and tests.
- Restored navigation/access to legacy customer and shop features without deleting the secure v3 flow.

## 12. Known limitations and risks

1. **Physical printing is not certified.** A real Windows machine, installed agent, configured printer and observed paper output are still required. See `docs/rebuild/m1-real-printer-certification.md`.
2. **Legacy management modules are not fully migrated.** Overview, production, customers, files, payments, ledger and legacy rates still use browser-side Supabase access and a local-storage compatibility gate. Replace with authenticated v3 API endpoints before production.
3. **The full customer studio is a legacy compatibility route.** Its multiple-file/photo/preview features are accessible but do not all flow through v3 immutable preparation artifacts and quotes.
4. **No online payment gateway is implemented in the v3 vertical slice.** Quotes are pricing/approval records, not captured payments.
5. **M1 is PDF-only.** DOCX/image/photo-grid support needs a defined server-side renderer/merger and immutable output artifact before it can be considered v3-native.
6. **Frontend bundle warning.** The Vite build succeeds but reports a JavaScript chunk larger than 500 kB. Route-level code splitting is recommended.
7. **Supabase least privilege.** The opaque secret-key server fallback is trusted-server only, but dedicated valid API/worker JWT signing would improve gateway-level least privilege.
8. **Repository is dirty and contains unrelated work.** Do not reset or overwrite unrelated mobile-app, résumé or pre-existing changes. Review `git status` before every edit.
9. **Demo/test records exist in the live pilot database.** They are retained as audit evidence or by retention cleanup. Do not confuse them with customer production jobs.

## 13. Highest-priority next work

1. Build authenticated v3 API endpoints for dashboard metrics, production jobs, customers, files/reprints, payments, ledger and rate-card administration.
2. Replace each legacy console module's direct Supabase calls with those endpoints, then remove local-storage authentication compatibility.
3. Decide which full-studio customer features are required for the pilot. Implement server-side PDF merging/layout rendering for those features and include all output-affecting options in the immutable quote/options hash.
4. Add preview URLs from prepared immutable artifacts rather than local pre-upload browser representations where possible.
5. Enroll a real Windows shop device, select the actual B&W/color printers and execute the real-printer certification checklist without bypassing uncertainty handling.
6. Run fault-injection and rollback drills and record evidence in `docs/rebuild/m1-fault-injection-results.md` and `docs/rebuild/m1-exit-gate.md`.
7. Add route-level frontend code splitting and browser-level end-to-end tests.

## 14. Rules for the next AI/engineer

- Read `docs/AutoPrint_Next_Version_Rebuild_Plan_v3.md` and relevant decision records under `docs/rebuild/decisions/`, but treat the repository and live schema as the source of truth.
- Inspect actual files and installed versions before editing or suggesting commands.
- Never expose `.env` values, passwords, capability tokens, device secrets, signed URLs or database credentials.
- Do not mark a job `completed` without permitted physical/spooler evidence.
- Preserve leases, fencing tokens, idempotency and immutable artifact/quote behavior.
- Do not silently merge legacy and v3 database models. Document and migrate boundaries explicitly.
- Preserve unrelated dirty-worktree changes.
- Run the relevant API, frontend and agent suites after changes.
- Update this document whenever architecture, migration state, live verification or major limitations change.

## 15. Phase 1 checkpoint A — integrated shop entry (26 August 2026)

**Status:** Implemented and self-verified; awaiting founder review. The full
Phase 1 remote-order policy is not complete.

The main customer routes now use the secure v3 experience directly:

- `/` and `/print` show one shop-entry screen.
- `/print/{SHOP_CODE}?entry=qr` is the canonical QR target.
- A customer can enter a shop code or reopen a shop saved on the current
  device.
- Shop codes and saved shops are resolved through a public, read-only v3 API
  contract before the print form is shown.
- Accepted orders record `qr`, `shop_code` or `saved_shop` as analytics/audit
  context; this value is never authorization.
- The old “open the full print studio” hyperlink was removed from the secure
  customer flow. Legacy `/kiosk` routes remain only for backward compatibility.

Verification on 26 August 2026:

- API suite: **48 run, 47 passed, 1 live-only test skipped**.
- Frontend tests: **8 passed**.
- Frontend production build: **passed**.
- Local route checks for `/`, `/print`, `/print/DEMO123` and
  `/order/test-order`: **HTTP 200**.

Migration `0013_phase1_order_entry_channel.sql` is included but was not applied
to a live database during this implementation session. Live QR/device testing,
the migration drill and the broader remote-order policy remain explicit review
limitations. See `docs/phases/phase-01-remote-orders/`.

For local founder review while the configured Supabase keys are invalid,
development environments expose the isolated code `DEMO001`. It exercises shop
selection, device saving and print-setting UI, but deliberately disables order
submission and can never reach a database or printer. Production environments
do not expose this fixture.

## 16. Phase 1 and Phase 2 self-verification checkpoint (26 August 2026)

**Status:** Phase 1 remote-order intake and Phase 2 pre-claim cancellation are built and self-verified locally. They are still awaiting founder review and target-environment migration before production approval.

Implemented Phase 1 scope:

- QR, shop-code and saved-shop entry remain inside the main customer software.
- Remote orders require a verified customer session.
- Shops can enable or pause remote intake from the v3 shop console.
- Pay-at-pickup remote jobs default to print-on-arrival and are not claimable until customer check-in.
- A shop can explicitly accept unpaid preprint risk per job with an audited reason.
- Customer status explains remote waiting/check-in state.

Implemented Phase 2 scope:

- Customer cancellation endpoint requires the order capability token and an idempotency key.
- Cancellation uses `cancel_print_job_if_unclaimed` to lock and update the order/job atomically.
- Cancellation succeeds only before any print attempt exists.
- If the device claim wins, cancellation returns a conflict and the customer sees that printing has already started.
- Cancelled jobs are excluded from the claim predicate and retain transition/audit evidence.

## 17. Phase 3 self-verification checkpoint (26 August 2026)

**Status:** Phase 3 pickup, collection, and no-show workflow has completed Stage 2 local hardening and isolated PostgreSQL lifecycle/concurrency verification. Founder review and real target-environment deployment evidence are still required; it is not approved for production.

Implemented Phase 3 scope:

- Migration `0016_phase3_pickup_lifecycle.sql` creates `shop_pickup_policies`, `pickups`, `pickup_attempts`, `notification_outbox`, and `shop_customer_trust` tables.
- Security-definer transactional RPCs: `create_or_ready_pickup_after_confirmed_print`, `redeem_pickup_code`, `manual_collect_pickup`, `expire_due_pickups`, `mark_pickup_no_show`, `void_pickup_for_terminal_order`, `set_pickup_policy`, `restore_customer_trust`.
- Deterministic 8-character pickup code derivation with unambiguous alphabet (no 0, O, 1, I) using versioned HMAC secret.
- Server-side rate limiter enforces max 5 attempts per 15-minute window per session bucket hash.
- Frontend components: `PickupCard`, `PickupQr`, `CustomerStatus` integration, `ShopPickups` queue with filter tabs and code redemption, `ShopPickupPolicy` owner settings.
- Background worker `services/api/worker/pickup_expiry.py` provides idempotent hold expiration with `FOR UPDATE SKIP LOCKED`.
- Migration `0019_phase3_pickup_transition_and_rate_limit_hardening.sql` makes terminal job-state/pickup synchronization transactional and moves pickup throttling to a database-authoritative advisory-lock RPC.
- Strict boundaries: No debt, fine, ledger, payment, or wallet side-effects; no cross-shop customer blacklisting.

Verification on 26 August 2026:

- API suite: **103 run, 102 passed, 1 live-only test skipped**.
- Disposable PostgreSQL: clean migration-runner application through `0019`, Phase 3 lifecycle/idempotency contract checks, and a six-session throttle race all passed (five allowed, one denied).
- Frontend tests: **11 passed, 0 failed**.
- Frontend production build: **passed (6.92s)**.
- Windows-agent tests: **9 passed, 0 failed**.

Review packages:

- `docs/phases/phase-01-remote-orders/`
- `docs/phases/phase-02-cancellation/`
- `docs/phases/phase-03-pickup/`

Known production blockers:

- Migrations `0013`–`0016` and `0019` have passed disposable PostgreSQL application but still need live target-environment application and verification.
- Production environment requires provisioning of `PICKUP_CODE_KEY_V1`.
- Live founder demonstration and physical printer certification required before marking Phase 3 approved.
- The disposable PostgreSQL pickup-creation/idempotency and rate-limit race drills passed. Real target-environment expiry, redemption and operational-worker verification remain required.

## 18. Phase 4 self-verification checkpoint (27 August 2026)

**Status:** Phase 4 nearby-shop discovery and directions workflow has completed Stage 3 local and isolated PostgreSQL verification. It is awaiting founder review and target-environment deployment evidence; it is not approved for production.

Implemented Phase 4 scope:

- Migration `0017_phase4_shop_discovery.sql` creates `shop_locations`, `shop_hours`, `shop_hour_exceptions`, and `shop_capabilities_public` tables.
- Forward migration `0020_phase4_discovery_safety_hardening.sql` makes manual closures expire after 12 hours and generates public directions only from stored validated coordinates.
- Pure-SQL haversine distance filtering RPC `find_nearby_shops` with 0.5–25 km radius bounds, pagination, and multi-criteria capability filters.
- Security-definer management RPCs: `set_shop_location`, `set_shop_hours`, `set_shop_discovery_enabled`, `set_shop_capabilities`.
- Public discovery endpoints:
  - `GET /api/v3/discovery/shops/nearby`: GPS-based distance sorting with 0.1 km rounded distance output.
  - `GET /api/v3/discovery/shops/search`: Locality/PIN code text query fallback for users with denied browser geolocation.
  - `GET /api/v3/discovery/shops/{shop_code}/profile`: Public card details, operating hours, capabilities, and coordinate-derived Google Maps directions.
- Shop management endpoints: owner/staff routes for updating location, weekly schedules, holiday date exceptions, public capabilities, and discovery flags.
- Safe helpers:
  - `app/maps_url.py`: Whitelist validation for stored shop references; public directions never use those links directly.
  - `app/shop_hours.py`: Server-side open/closed evaluation supporting holiday exceptions, expiring manual overrides, weekly schedules, and cross-midnight overnight shifts.
- Strict boundaries: Zero embedded map SDKs, no queue ETAs (deferred to Phase 5), no public ratings (deferred to Phase 8).

Verification on 27 August 2026:

- Focused discovery suite: **15 passed, 0 failed**.
- Clean disposable PostgreSQL run through migration `0020` passed two-shop distance ordering, expired manual closure recovery, and coordinate-derived directions.

Review package:

- `docs/phases/phase-04-discovery/`



## 19. Phase 5 self-verification checkpoint (27 August 2026)

**Status:** Phase 5 Queue Workload and Readiness Estimates completed Stage 4 local hardening, target-database migration and schema verification. It is awaiting a real-printer accuracy sample and founder review; it is not approved for public ETA display.

Implemented Phase 5 scope:

- Migration `0018_phase5_queue_estimates.sql` creates physical-printer-aware `shop_printer_lanes`, lane-specific `shop_walkin_backlogs`, and immutable prediction/calibration records.
- Security-definer RPC `calculate_queue_estimate` mirrors print-claim eligibility, computes workload from selected pages/copies/duplex/colour, and returns `unavailable` until a configured lane has a fresh agent heartbeat.
- Python helper `queue_estimates.py` never presents unknown telemetry as a ready-time promise.
- Endpoints in `estimates.py` exposed for public and shop management.
- Lanes may be configured as independent or as a shared physical printer, so B&W work affects colour estimates only when it should.

Verification on 27 August 2026:

- Disposable PostgreSQL migration and Phase 5 verification script passed, including lane sharing, backlog expiry, stale heartbeat, selected-page workload, and prediction/actual calibration checks.
- Updated focused API suite: **12 passed, 0 failed**; full API regression: **106 passed, 1 live-only skipped**.
- Target database: migrations `0013`–`0020` applied on 27 August 2026; `AUTOPRINT_V3_SCHEMA_VERIFIED` and authenticated shop queue API check returned HTTP 200.
