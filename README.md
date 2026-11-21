# OmniFlow

> A standalone multi-channel messaging automation web app for WhatsApp Business Cloud API, Instagram Messaging, and Facebook Messenger, built on Cloudflare's free tier.

Designed for small businesses (clinics, retail, travel agencies, salons) with a **single-tenant per client** architecture. Clients run their own isolated instance in their own free Cloudflare account, own their data, and pay Meta directly for conversation fees.

> **Stage 2 shipped:** the full premium dashboard UI (Evergreen Mist design, English UI, mobile bottom nav + desktop sidebar), multi-account Channels wizards for WhatsApp / Instagram / Messenger, staff inbox replies with handover, and rule management. See [`docs/DASHBOARD_GUIDE.md`](docs/DASHBOARD_GUIDE.md) for the complete local-run + deployment + Meta webhook walkthrough.

---

## Tech Stack

- **Backend Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) (TypeScript + [Hono](https://hono.dev/))
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite at the edge)
- **Frontend**: React + Vite + Tailwind CSS (Hosted via Cloudflare Workers Static Assets)
- **Tooling**: Node.js v22+, npm workspaces, Wrangler CLI, TypeScript strict mode

---

## Project Structure

```
OmniFlow/
├── apps/
│   ├── api/                   # Cloudflare Worker backend (Hono)
│   │   ├── src/               # Routes, adapters, services, middleware
│   │   └── wrangler.jsonc     # Cloudflare Worker, D1 & static-assets configuration
│   └── web/                   # Dashboard SPA (Stage 2 — React + Vite)
│       ├── src/pages/         # Login, Dashboard, Inbox, Customers, Replies, Channels, Settings
│       └── tailwind.config.ts # Evergreen Mist design tokens
├── packages/
│   └── shared/                # Channel-agnostic DTOs, types, constants
├── migrations/                # D1 SQLite migrations (0001 schema, 0002 settings, 0003 automation)
├── docs/
│   ├── SPEC.md                # Vision, personas, business model, phases
│   ├── RULES.md               # Mandatory engineering, privacy & testing rules
│   ├── ARCHITECTURE.md        # Technical specs, limits, D1 schema, security
│   ├── DESIGN_SYSTEM.md       # "Evergreen Mist" color tokens & UI guidelines
│   └── DASHBOARD_GUIDE.md     # Stage 2: local run, deploy, Meta webhook & test-number guide
├── tests/                     # Automated local verification tests (12 suites)
├── .env.example               # Sanitized environment template
└── package.json               # Monorepo root scripts
```

---

## Quick Start on Windows

### 1. Prerequisites
- **Node.js**: v22.0.0 or higher (`node -v`)
- **Git**: Installed and available in PowerShell (`git --version`)
- **Cloudflare Account**: Free tier account at [dash.cloudflare.com](https://dash.cloudflare.com) (for deployment)

### 2. Installation
Open PowerShell in the project directory:

```powershell
# Install all dependencies across the monorepo
npm install
```

### 3. Local Environment Configuration
Copy the template environment file for local Worker execution:

```powershell
Copy-Item .env.example apps/api/.dev.vars
```

Generate local cryptographic keys for development:
```powershell
# 32-byte Base64 encryption key:
node -e "console.log(crypto.randomBytes(32).toString('base64'))"

# 32-byte Hex lookup hash secret:
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```
Paste these generated values into `apps/api/.dev.vars`.

### 4. Apply Local D1 Database Migration
Cloudflare Wrangler creates and manages an isolated local SQLite database:

```powershell
# Apply initial schema migration locally
npm run d1:migrate:local
```

### 5. Start the Local Development Server
Start the Hono API Worker locally:

```powershell
npm run dev
```

The Worker will start on `http://localhost:8787`. You can verify it immediately:
- **Health Check**: Open [http://localhost:8787/health](http://localhost:8787/health) in your browser.
- **Dashboard**: Open [http://localhost:8787/](http://localhost:8787/) — the Evergreen Mist dashboard SPA (login with your local `ADMIN_PASSWORD`)

Expected `/health` output:
```json
{
  "status": "ok",
  "app": "OmniFlow",
  "version": "0.1.0",
  "timestamp": "2026-11-18T07:45:00.000Z",
  "environment": "development",
  "uptimeSeconds": 12
}
```

---

## Run Locally

Follow these exact 4 steps to verify the entire system locally:

### Prerequisites: Environment Setup & Health Check
1. Configure local secrets in `apps/api/.dev.vars` (never committed):
   ```powershell
   Copy-Item .env.example apps/api/.dev.vars
   ```
2. Apply local D1 database migrations:
   ```powershell
   npm run d1:migrate:local
   ```
3. Start the local Worker dev server:
   ```powershell
   npm run dev
   ```
4. Verify the health check at [http://localhost:8787/health](http://localhost:8787/health):
   ```json
   {
     "status": "ok",
     "app": "OmniFlow",
     "version": "0.1.0",
     "environment": "development"
   }
   ```

---

### Step 1: Real Local Smoke Test under Wrangler Dev
Executes an end-to-end webhook handshake, HMAC verification, and background auto-reply pipeline against a local D1 instance running in Miniflare:
```powershell
npm run smoke
```
- **What it does**: Spawns `wrangler dev`, tests the GET challenge handshake, posts an HMAC-signed Malayalam WhatsApp message, waits for background `waitUntil` execution, and queries local D1.
- **Assertions**:
  - `messages`: outbound row exists with `is_simulated = 1` and `delivery_status = 'simulated'`.
  - `webhook_events`: inbound event row has `processing_status = 'processed'`.
- **Termination**: Terminates cleanly with exit code 0 via Windows-safe process tree kill (`taskkill /pid <pid> /T /F`).
- **Forced Failure Proof**: Changing verify token or tamper HMAC immediately causes the smoke script to exit with code 1 within ~30 seconds without hanging.

---

### Step 2: Run Full Automated Test Suite
Executes all 112 automated tests across 12 test suites in the native Node test runner:
```powershell
npm test
```
**Test Coverage**:
- `tests/crypto.test.ts`: AES-256-GCM encryption/decryption round-trip, tamper resistance, keyed HMAC lookup hashes, `crypto.subtle.verify` constant-time HMAC check.
- `tests/d1-migration.test.ts`: Migrations 0001 & 0002, safety constraints, `in_reply_to_message_id` UNIQUE reply guarantee.
- `tests/health.test.ts`: `GET /health`, root service info, 404 handler, global security headers.
- `tests/meta-client.test.ts`: Meta Graph API client, error code 190 (token expiration) & 131047 (24-hr care window) mapping.
- `tests/scheduled.test.ts`: Workers `scheduled()` handler, cron-triggered purge of expired webhook events older than retention period.
- `tests/tenant-isolation.test.ts`: Cross-tenant boundary enforcement across messages, contacts, and conversations.
- `tests/whatsapp-reply.test.ts`: Test mode allowlist (empty fails closed, normalized matching), dry-run safety simulation, Malayalam script detection, human handover pause.
- `tests/whatsapp-webhook.test.ts`: Handshake verification, HMAC rejection, batch duplicate handling without message loss (Bug 1), unregistered channel skipping without retry storm (Bug 2), missing/invalid crypto keys fail-closed (Bug 4), and PII phone masking (Bug 5).
- `tests/automation.test.ts`: Phase 2 engine — dual-format keyword rules, priority ordering, bilingual reply resolution, handover timeout expiry, business hours, reply dedupe, tenant isolation.
- `tests/admin-routes.test.ts`: Dashboard backend — fail-closed auth, settings CRUD, rules CRUD, accounts CRUD, conversations inbox.
- `tests/admin-phase3.test.ts`: Stage 2 — staff reply (simulated + real dispatch + Meta failure mapping), mark-as-read, account token rotation (token never returned), webhook-info secret safety, contacts PII masking, tenant-scoped daily stats.
- `tests/messaging-webhooks.test.ts`: Instagram & Messenger ingestion pipelines mirroring the WhatsApp safety behaviours.

---

### Step 3: Fresh-Clone Lint (No Prior Build Required)
Run type checking and linting on the API package:
```powershell
npm --workspace=apps/api run lint
```
Thanks to TypeScript path aliases and package.json exports resolving directly to `packages/shared/src/index.ts`, linting passes immediately on a fresh clone without having to build `packages/shared` first.

---

### Step 4: Web Application Build
Compile and bundle the React + Vite frontend SPA:
```powershell
npm --workspace=apps/web run build
```
Generates production assets in `apps/web/dist/` ready to be served by Cloudflare Workers Static Assets (`run_worker_first = true`).

---

## Cloudflare Free Tier Capacity & Safety

OmniFlow is specifically optimized to run permanently within Cloudflare's free allowances:

- **100,000 requests / day**: A typical small business handling ~500 messages/day uses < 6,000 requests/day (< 6% of quota).
- **10 ms CPU time / invocation**: All cryptographic hashing uses native `crypto.subtle` in C++ (< 0.2 ms CPU).
- **5,000,000 D1 rows read / day**: Zero full table scans; all queries are backed by composite indexes.
- **100,000 D1 rows written / day**: Efficient batched writes and debounced status receipts.
- **500 MB D1 database size**: Sufficient for ~1,000,000 text messages (~3–5 years of small business history). Raw webhook events are automatically pruned after 7–14 days.

---

## First Real Test With the Laptop OFF

Follow these exact steps when you are ready to deploy and test OmniFlow live on your own free Cloudflare account with a real WhatsApp test number, completely independent of your local machine.

### Step 1: Log in to Cloudflare & Create Remote Database
```powershell
# 1. Log in to your Cloudflare account
npx wrangler login

# 2. Create the production Cloudflare D1 database
npx wrangler d1 create omniflow-db
```
Copy the returned `database_id` and paste it into `apps/api/wrangler.jsonc` under `d1_databases[0].database_id`.

### Step 2: Apply Remote Migrations
```powershell
# Applies 0001_initial_schema.sql and 0002_tenant_settings.sql to remote D1
npm run d1:migrate:remote
```

### Step 3: Set Production Secrets in Cloudflare
Generate 32-byte keys locally:
```powershell
# Base64 encryption key:
node -e "console.log(crypto.randomBytes(32).toString('base64'))"

# Hex lookup hash secret:
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

Inject secrets into Cloudflare Worker Secrets (these are encrypted by Cloudflare at rest and never committed):
```powershell
npx wrangler secret put META_APP_SECRET --config apps/api/wrangler.jsonc
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN --config apps/api/wrangler.jsonc
npx wrangler secret put ENCRYPTION_KEY --config apps/api/wrangler.jsonc
npx wrangler secret put LOOKUP_HASH_SECRET --config apps/api/wrangler.jsonc
```

### Step 4: Seed Remote Tenant & Sample Rules
Run the interactive safe remote seeding script (it encrypts the system token using AES-256-GCM before writing to remote D1):
```powershell
npm run seed:remote
```
- Sets `automation_mode = 'test'` (or `'live'`).
- Sets `dry_run = 0` (to send real WhatsApp replies).
- Adds your personal phone number (e.g. `919876543210`) to the allowlist.
- Seeds 3 multi-lingual sample rules:
  1. **Greeting** ("hi", "hello", "നമസ്കാരം")
  2. **Brochure & Pricing** ("price", "rate", "cost", "വില", "വിവരം")
  3. **Default Fallback** (catches any unmapped question)

### Step 5: Deploy Worker & Static Frontend
```powershell
# Compiles web SPA and deploys the unified Worker
npm --workspace=apps/api run deploy
```
Wrangler will output your live URL: `https://omniflow-api.<your-subdomain>.workers.dev`.

### Step 6: Configure Meta Developer App Dashboard
1. Go to [developers.facebook.com](https://developers.facebook.com/) > Select your App > **WhatsApp** > **Configuration**.
2. Click **Edit** next to **Webhook**:
   - **Callback URL**: `https://omniflow-api.<your-subdomain>.workers.dev/api/v1/webhooks/whatsapp`
   - **Verify Token**: Enter the exact string configured in `META_WEBHOOK_VERIFY_TOKEN`.
   - Click **Verify and Save**. (Your Worker verifies the token and returns the challenge in < 30ms).
3. Under **Webhook fields**, click **Manage** and subscribe to **`messages`**.

### Step 7: Add Test Recipient in Meta Dashboard
1. Navigate to **WhatsApp** > **API Setup**.
2. Under "Step 2: To", select **Manage phone number list** and add your personal WhatsApp number.
3. Enter the 6-digit verification code you receive on WhatsApp.

### Step 8: Send Live WhatsApp Message & Verify
1. Open WhatsApp on your phone and send a message to the Meta Test Number:
   - Send: `"hi"` or `"വില വിവരങ്ങൾ അറിയണം"`
2. **What you should see in WhatsApp**:
   - You will instantly receive an automated reply in Malayalam/English matching the rule!
3. **What you should see in D1**:
   Run this command in PowerShell to inspect the remote database records:
   ```powershell
   npx wrangler d1 execute omniflow-db --remote --config apps/api/wrangler.jsonc --command "SELECT direction, sender_type, delivery_status, body FROM messages ORDER BY created_at DESC LIMIT 5;"
   ```
   Output will show:
   - Row 1: `direction = 'outbound'`, `delivery_status = 'sent'`, with Meta's returned `provider_message_id`.
   - Row 2: `direction = 'inbound'`, `delivery_status = 'delivered'`, with the customer's text.

### Step 9: Emergency Rollback & Disable Procedure
If you ever want to immediately stop all automated replies without modifying code or redeploying:
```powershell
npx wrangler d1 execute omniflow-db --remote --config apps/api/wrangler.jsonc --command "UPDATE tenant_settings SET automation_mode = 'off';"
```
This immediately sets the system to fail-closed: webhook events will be logged for audit, but zero outbound replies or API calls will be made.

#   o m n i f l o w - A u t o  
 