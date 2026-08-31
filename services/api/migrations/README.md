# AutoPrint v3 Database Migrations

This directory contains the forward-only, transactional migration sequence for the AutoPrint v3 clean rebuild under namespace `autoprint_v3`.

## Migration Sequence

1. **`0000_preflight_inventory.sql`**: Read-only preflight inventory script exporting version, extensions, tables, columns, RLS policies, RPCs, grants, and bucket state.
2. **`0001_v3_types_and_core.sql`**: Defines core enums (`migration_mode`, `membership_role`, `device_status`, `order_status`, `preparation_status`, `cleanup_status`, `job_status`, `attempt_status`, `actor_type`, `completion_source`) and core v3 tables (`users`, `shop_memberships`, `user_sessions`, `devices`, `device_enrollment_codes`, `orders`, `source_documents`, `preparation_tasks`, `print_artifacts`, `rate_cards`, `price_quotes`, `print_jobs`, `print_attempts`, `job_transitions`, `allowed_job_transitions`, `audit_events`, `idempotency_keys`).
3. **`0002_v3_constraints_indexes.sql`**: Defines foreign key constraints, check constraints (positive counts/amounts, immutable hashes), and performance indexes.
4. **`0003_v3_roles_grants_rls.sql`**: Defines strict RLS policies and role grants. Removes direct mutation rights from `anon` and `authenticated` PostgREST roles on v3 tables.
5. **`0004_v3_canary_backfill.sql`**: Defines initial migration mode defaults on `public.shops` and populates canary shop initial rate card and owner membership.
6. **`0005_v3_state_machine.sql`**: Populates `allowed_job_transitions` table with the closed state machine rule matrix.
7. **`0006_v3_transaction_functions.sql`**: Implements fenced printing, atomic enrollment, upload finalization, preparation completion/failure, quote acceptance, shop decisions, and expired-lease reconciliation RPCs.
8. **`0007_v3_canary_cutover.sql`**: Changes exactly one verified `CANARY01` shop from `legacy` to `v3_canary` after verifying every other shop remains legacy.
9. **`0008_v3_canary_rollback.sql`**: Reverts only `CANARY01` to `legacy` after draining active attempts. It preserves the v3 schema, roles, jobs, attempts, transitions, and audit history.
10. **`0009_v3_postgrest_exposure.sql`**: Adds `autoprint_v3` to the PostgREST schema list while keeping Storage private behind the Storage API.
11. **`0010_v3_postgrest_schema_reload.sql`**: Reloads the PostgREST schema cache after the v3 tables and RPCs are installed.
12. **`0011_v3_crypto_search_path.sql`**: Makes fenced lease functions resolve Supabase's trusted `extensions.gen_random_bytes` implementation.
13. **`0012_fix_claim_transition_validation.sql`**: Keeps claim transition validation inside `claim_next_print_job` and attempt validation inside `advance_print_attempt`.
14. **`0013_phase1_order_entry_channel.sql`**: Records whether a customer selected a shop through its QR, a typed shop code, or a saved shop. This value is analytics context only, never authorization.
15. **`0014_phase1_remote_order_policy.sql`**: Adds verified customer sessions, shop remote-intake policy, pay-at-pickup snapshots, print-on-arrival claim eligibility, check-in, and audited per-job unpaid-risk acceptance.
16. **`0015_phase2_atomic_customer_cancellation.sql`**: Adds idempotent cancellation and a row-locking RPC that races safely against device claim while preserving transition, audit, and cleanup evidence.
17. **`0016_phase3_pickup_lifecycle.sql`**: Adds pickup lifecycle tables (policies, pickups, rate-limit attempts, notification outbox, shop-customer trust) and transactional RPCs for confirmed print readiness, secure redemption, manual collection, hold expiry, no-show reporting, and trust updates.
18. **`0019_phase3_pickup_transition_and_rate_limit_hardening.sql`**: Synchronizes pickup readiness/voiding in the same database transaction as terminal print-job state changes and replaces process-local pickup throttling with a database-authoritative rolling-window RPC. The runner applies it immediately after `0016`, because it depends only on Phase 3.
19. **`0017_phase4_shop_discovery.sql`**: Adds public shop location, operating hours, date exceptions, customer-visible capabilities and the bounded nearby-shop discovery RPC.
20. **`0020_phase4_discovery_safety_hardening.sql`**: Makes manual shop closures expire after 12 hours and makes public directions derive from validated stored coordinates rather than the owner-provided Maps URL.
21. **`0018_phase5_queue_estimates.sql`**: Adds initial printer-lane, walk-in backlog and calibration tables plus the queue-estimate RPC. It remains disabled pending Phase 5 hardening and founder review.
22. **`0021_optional_customer_job_name.sql`**: Adds the optional customer-visible order label.
23. **`0022_shop_print_option_overrides.sql`**: Adds audited per-job shop option overrides while preserving the agent contract.
24. **`0023_batch_quote_items.sql`**: Adds quote line items, line-linked jobs, and idempotent batch acceptance.
25. **`0024_complete_batch_quote_pipeline.sql`**: Atomically creates batch quotes, removes the obsolete one-job-per-quote constraint, leases the exact uploaded document during inline preparation, resolves each agent claim from its line options/hash, and extends cancellation atomically across every unclaimed line.

## Verification
Run `verify_v3_schema.sql` to validate that all required tables, columns, constraints, RLS policies, and grants exist.

Migrations are never applied by the application. Run the migration runner (or paste the reviewed SQL into Supabase) as a separate release step.
