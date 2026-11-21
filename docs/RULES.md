# OmniFlow — Strict Engineering & Governance Rules (RULES.md)

This document outlines the mandatory engineering, security, privacy, and quality standards for **OmniFlow**. Every contributor and AI agent must adhere strictly to these rules without exception.

---

## 1. Absolute Isolation & Independence Rules

- **Zero WordPress / Legacy Dependency**: OmniFlow is a completely independent, fresh implementation. **NEVER** import, copy, reference, or depend on any WordPress, MARKU plugin, or prior client codebases, credentials, databases, or brand assets.
- **Dedicated Git Repository**: All commits, branches, and configs belong strictly to this standalone Git repository.
- **No Premature Deployment**: **NEVER** deploy to Cloudflare, push to GitHub, create paid resources, or enable billing without the user's explicit command.

---

## 2. Security & Secret Management

- **Zero Secrets in Code or Git**:
  - **NEVER** hardcode or commit API tokens, App Secrets, Webhook Verify Tokens, or encryption keys.
  - `.env` and `.dev.vars` must remain strictly gitignored. Only sanitized placeholder templates belong in `.env.example`.
- **At-Rest Token & Recipient Encryption**:
  - All Meta Graph API access tokens, app secrets, and customer platform sender IDs (`wa_id`, `IGSID`, `PSID`) stored in D1 **MUST** be encrypted using **AES-256-GCM** before persistence.
  - The master `ENCRYPTION_KEY` is injected strictly via Cloudflare Worker Secrets (`wrangler secret put ENCRYPTION_KEY`). It is never stored in D1, logged, or sent to the frontend.
- **Keyed HMAC for Contact Lookups**:
  - Never store plain SHA-256 hashes of phone numbers or sender IDs. Always use a keyed HMAC-SHA256 (`LOOKUP_HASH_SECRET`) to prevent rainbow table attacks.
- **Webhook Ingestion Verification**:
  - Webhooks from Meta **MUST** be cryptographically verified using Web Crypto HMAC-SHA256 over the **RAW request body buffer** before any JSON parsing or database interaction occurs.
  - Verification comparison **MUST** use constant-time byte comparison (`crypto.subtle.timingSafeEqual` or bitwise XOR accumulator) to eliminate timing attacks.

---

## 3. Privacy & PII Handling

- **Never Log Sensitive PII**:
  - **NEVER** output unmasked customer phone numbers, sender IDs, access tokens, or raw message bodies to `console.log`, monitoring services, or audit trails.
  - Customer phone numbers in UI and logs must be masked (e.g. `+91 98**** 1234`).
- **Webhook Event Retention Policy**:
  - Raw webhook event logs in D1 must be minimized and scheduled for automatic purging after **7–14 days** to eliminate D1 database bloat and comply with data minimization principles.

---

## 4. Multi-Tenant Safety in Single-Tenant Code

- **Tenant Scoping Everywhere**:
  - Even though single-tenant client deployments use one active business tenant (`ten_default`), **EVERY** database query, insert, update, and API route **MUST** explicitly filter and include `tenant_id`.
  - Zero cross-tenant queries: No query may omit `WHERE tenant_id = ?`.
- **Demo Workspace Isolation**:
  - Demo workspaces (`is_demo = 1`) must remain completely segregated. Demo data must never be mixed with client live data and must be purgeable with a single command.

---

## 5. Free-Tier Performance & CPU Limits

- **10 ms CPU Time Budget**:
  - Cloudflare Workers Free Tier enforces a strict **10 ms CPU time limit** per invocation.
  - **NEVER** run CPU-heavy operations inside Workers: no bcrypt, no Argon2, no synchronous image manipulation, no expensive regex backtracking.
  - All cryptography must use native Web Crypto API (`crypto.subtle`) which executes in the native C++ V8 runtime without consuming standard script CPU limits.
- **Zero Full Table Scans in D1**:
  - D1 Free Tier counts **scanned rows**, not returned rows, toward the 5,000,000 daily read limit.
  - **EVERY** query must be backed by an index. Every list query must specify `LIMIT` and `OFFSET`.
- **Fast 200 Acknowledgement**:
  - Inbound webhooks must return HTTP 200 in `< 50ms`. All downstream operations (D1 inserts, rule matching, Meta replies) must run in `ctx.waitUntil()`.

---

## 6. Testing, Quality & Integrity Standards

- **Honest Test Reporting**:
  - **NEVER** report a build, test, or check as "passed" unless you have executed the command and observed an exit code of 0.
  - If a test fails, report the exact error output immediately.
- **Plain-Language User Errors**:
  - Customer-facing and business-owner-facing error messages must be written in simple, polite, jargon-free English (or Malayalam when localized).
  - Never expose internal database errors, SQL syntax errors, or stack traces in the UI.

---

## 7. Phase Progression Discipline

- **Do ONLY the Current Phase**:
  - Do not implement Phase 1 webhooks, Phase 2 rule engines, or Phase 3 dashboard screens during Phase 0.
  - Work proceeds strictly phase-by-phase upon user review and approval.
