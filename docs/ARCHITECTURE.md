# OmniFlow — Architecture & Infrastructure Specification (ARCHITECTURE.md)

**Document Version:** 0.1.0  
**Target Runtime:** Cloudflare Workers (TypeScript + Hono) + Cloudflare D1 (SQLite)  
**Deployment Target:** Single-Tenant per Client (Self-Hosted on Client's Cloudflare Free Account)

---

## 1. High-Level System Architecture

OmniFlow decouples channel-specific protocols from business logic using a **Channel Adapters + Shared Automation Engine** pattern.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL MESSAGING PLATFORMS                              │
│       WhatsApp Cloud API     │    Instagram Messaging      │    Facebook Messenger     │
└──────────────────────────────┴──────────────┬──────────────┴───────────────────────────┘
                                              │ Webhook Event (X-Hub-Signature-256)
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE WORKER: INGESTION & ROUTING                          │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                Hono Router & App                                 │  │
│  │    GET /health           POST /api/v1/webhooks/:channel       Static UI Assets   │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ ArrayBuffer                               │
│                                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                      Security Verification (< 2 ms CPU)                          │  │
│  │   • HMAC-SHA256 signature verification over raw body buffer via crypto.subtle   │  │
│  │   • Constant-time byte equality check (timingSafeEqual)                          │  │
│  │   • Return HTTP 200 "EVENT_RECEIVED" immediately (< 40ms total wall-clock)       │  │
│  │   • Offload processing to background via executionCtx.waitUntil()                │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ Dispatched Job                            │
│                                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           Channel Adapters Layer                                 │  │
│  │   ┌────────────────────┐   ┌─────────────────────┐   ┌──────────────────────┐    │  │
│  │   │  WhatsApp Adapter  │   │  Instagram Adapter  │   │  Messenger Adapter   │    │  │
│  │   └─────────┬──────────┘   └──────────┬──────────┘   └──────────┬───────────┘    │  │
│  │             └─────────────────────────┼─────────────────────────┘                │  │
│  │                                       ▼                                          │  │
│  │                      Normalized Inbound Event DTO                                │  │
│  └──────────────────────────────────────┬───────────────────────────────────────────┘  │
│                                         │                                              │
│                                         ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         Shared Automation Engine                                 │  │
│  │   • Event Deduplication (dedupe_key check)                                       │  │
│  │   • Contact Resolver (AES-GCM decrypt / Keyed HMAC lookup)                       │  │
│  │   • Conversation Session & 24-Hour Customer Care Window Checker                  │  │
│  │   • Human Handover State Resolver (bot vs human_requested vs human_assigned)     │  │
│  │   • Rule Matcher (Priority, Trigger Type, Business Hours, Malayalam/English)     │  │
│  │   • Outbound Message Dispatcher (Meta Graph API Client)                          │  │
│  └──────────────────────────────────────┬───────────────────────────────────────────┘  │
│                                         │                                              │
│                                         ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Persistence Layer: Cloudflare D1 (SQLite)                    │  │
│  │   tenants │ channel_connections │ contacts │ conversations │ messages            │  │
│  │   webhook_events │ automation_rules                                              │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Verified Cloudflare Free-Tier Limits & Official Documentation

Every platform limit below is sourced directly from Cloudflare's official documentation. Any architectural assumptions or estimates are explicitly labeled as **[Estimate]** vs **[Official Limit]**.

### Official Reference URLs:
1. **Cloudflare Workers Platform Limits:**  
   `https://developers.cloudflare.com/workers/platform/limits/`
2. **Cloudflare Workers Pricing & Allowances:**  
   `https://developers.cloudflare.com/workers/platform/pricing/`
3. **Cloudflare D1 Platform Limits:**  
   `https://developers.cloudflare.com/d1/platform/limits/`
4. **Cloudflare D1 Pricing & Allowances:**  
   `https://developers.cloudflare.com/d1/platform/pricing/`
5. **Cloudflare Workers Static Assets Pricing & Routing:**  
   `https://developers.cloudflare.com/workers/static-assets/routing/`

### Limit Breakdown & OmniFlow Capacity Analysis:

| Resource / Metric | Verified Cloudflare Free Limit [Official] | Official Reference Link | OmniFlow Estimated Consumption [Estimate] | Graceful Degradation / Architectural Safeguard |
| :--- | :--- | :--- | :--- | :--- |
| **Worker Requests** | **100,000 requests / day** (account-wide, resets at 00:00 UTC) | [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Typical small business handling 200–500 customer interactions/day consumes ~2,000–6,000 requests/day (< 6% of quota). | If daily requests exceed 100k, Cloudflare edge responds with HTTP 1027. Meta webhooks automatically retry for up to 48 hours with exponential backoff until quota resets. |
| **Worker CPU Time** | **10 ms CPU time per invocation** | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) | Web Crypto HMAC-SHA256 and AES-GCM run in native C++ V8 runtime (< 0.2 ms). Routing & JSON parsing takes ~1.2 ms. Total active CPU: **~1.5 ms**. | Heavy cryptographic hashing (bcrypt/Argon2) is banned. CPU budget is strictly monitored in tests. |
| **External Subrequests** | **50 external subrequests per invocation** | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) | Max 1–2 outbound `fetch()` calls to Meta Graph API per inbound message. | Never exceeds 2 subrequests per invocation. |
| **D1 Rows Read** | **5,000,000 rows read / day** (measured by rows scanned) | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) | Indexed lookups scan exactly 1 row per check. 500 messages/day with indexed reads consumes ~3,000 scanned rows/day (< 0.1% of quota). | **Zero full table scans**: all D1 queries use composite indexes with `tenant_id`. Unindexed queries are caught by CI linters. |
| **D1 Rows Written** | **100,000 rows written / day** (INSERT, UPDATE, DELETE) | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) | 500 inbound messages + replies + status events generates ~2,500–4,000 row writes/day (< 4% of quota). | Status events are debounced; read receipts can be selectively written. |
| **D1 Database Storage** | **500 MB max per DB** (5 GB account total across max 10 DBs) | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) & [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) | Text message record is ~500 bytes. 500 MB holds ~1,000,000 messages (3–5 years of small business history). | Raw webhook events are automatically purged after 7–14 days. Media files are referenced via Meta CDN or external Cloudflare R2, never stored as raw blobs in D1. |
| **Static Asset Requests** | **Free and unlimited** (serving static HTML/JS/CSS files incurs no request or duration charge) | [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/routing/) | Dashboard static files are cached at Cloudflare edge. | Requests matching static files bypass Worker script execution, preserving the 100k daily dynamic request quota for API/webhooks. |

---

## 3. Frontend Hosting Architecture: Workers with Static Assets

Cloudflare previously offered two separate platforms: Cloudflare Pages (for frontend) and Cloudflare Workers (for backend). In 2024–2025, Cloudflare introduced **Workers with Static Assets** as the unified standard for modern full-stack applications.

### Why OmniFlow Uses Workers with Static Assets:
1. **Single Deployment & Single Unit of Infrastructure**: In client deployments, running `wrangler deploy` deploys both the backend API and the compiled React SPA simultaneously. The client does not need to configure two separate Cloudflare products (Pages + Workers).
2. **Zero CORS & Same-Origin Routing**: Dynamic API routes live under `/api/v1/*` and static frontend assets live at `/*` on the exact same domain (`https://omniflow.<client>.workers.dev` or custom domain). No cross-origin headers or complex cookie flags required.
3. **Free Static Delivery**: Cloudflare serves static assets directly from its edge cache without invoking the Worker script, ensuring dashboard asset downloads do not consume the 100,000 daily Worker invocation allowance.

---

## 4. D1 Schema Architecture & Rationale

The database schema (`migrations/0001_initial_schema.sql`) implements 7 lean tables with strict data protection and deduplication standards:

### 1. `tenants`
- Root organizational entity.
- Single-tenant deployment initializes one business tenant (`id = 'ten_client_xxxx'`) and one optional demo workspace (`id = 'ten_demo_sample'`, `is_demo = 1`).

### 2. `channel_connections`
- Stores credentials for WhatsApp Phone Number IDs, Instagram Business Accounts, and Facebook Pages.
- `encrypted_access_token`: AES-256-GCM encrypted System User Access Token.
- `token_preview`: Masked prefix (e.g. `EAAG...3xYd`) for human identification in the UI.

### 3. `contacts`
- Customer identities across channels.
- **Recipient ID Security**: Real recipient IDs (`wa_id`, `IGSID`, `PSID`) are stored in `encrypted_platform_sender_id` (AES-256-GCM) so the platform can reply, but raw PII is never exposed in plaintext in the database.
- **Keyed HMAC Lookup Hash**: `lookup_hash` stores an HMAC-SHA256 of `channel_type:recipient_id` keyed by `LOOKUP_HASH_SECRET`. This enables instant $O(1)$ indexed lookups without exposing raw phone numbers or allowing rainbow-table attacks.
- `phone_number_masked`: Display-only string (e.g. `+91 98**** 1234`).

### 4. `conversations`
- Thread representation between a contact and a channel.
- `handover_state`: Manages control state (`bot` vs `human_requested` vs `human_assigned`).
- `last_customer_message_at`: ISO-8601 UTC timestamp tracking Meta's 24-hour customer care window. Non-template outbound messages are blocked if `now - last_customer_message_at > 24 hours`.

### 5. `messages`
- Granular message exchange history.
- `provider_message_id`: Meta message ID (`wamid.HBg...` or `mid.$...`).
- **Nullable for Outbound Messages**: Outbound messages are inserted in `pending` state before Meta's API responds; `provider_message_id` is initially `NULL` and updated upon delivery confirmation.
- `UNIQUE (channel_connection_id, provider_message_id)`: SQLite standard allows multiple `NULL` values without conflict while enforcing strict deduplication for non-null IDs.

### 6. `webhook_events`
- Ingestion and deduplication log.
- `dedupe_key`: Composite deduplication key defined per channel:
  - WhatsApp Inbound Message: `wamid`
  - WhatsApp Status Update: `wamid:status:timestamp` (e.g. `wamid.xxx:delivered:1710000000`)
  - Instagram Inbound DM: `mid`
  - Instagram Status Update: `mid:status:timestamp`
  - Messenger Inbound DM: `mid`
  - Messenger Status Update: `mid:status:timestamp`
- **Data Minimization & Purge Policy**: Full raw payloads are never kept indefinitely. `payload_summary_json` stores only extracted metadata; `raw_payload_preview` stores at most 500 characters with all 6+ digit phone numbers masked. A daily Cloudflare Workers Cron Trigger (`0 3 * * *`, daily at 03:00 UTC) invokes `scheduled()` which runs `purgeExpiredWebhookEvents` to purge records older than **7–14 days** (`WHERE retention_expires_at <= datetime('now')`).

### 7. `automation_rules`
- Fast trigger-action evaluation table.
- Indexed by `(tenant_id, is_active, priority DESC)`.
- Triggers support keyword lists (Malayalam and English JSON array: `["rate", "price", "വില", "ചിലവ്"]`).

---

## 5. Security & Cryptographic Model

### 1. Ingestion HMAC-SHA256 Verification
Meta signs every webhook event using the application secret in the header `X-Hub-Signature-256: sha256=<hex>`.
- The Worker reads the raw binary body (`await c.req.raw.arrayBuffer()`).
- Using native `crypto.subtle.importKey` and `crypto.subtle.sign`, the expected digest is computed.
- Constant-time comparison prevents timing analysis:
```typescript
export function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let c = 0;
  for (let i = 0; i < a.byteLength; i++) {
    c |= a[i] ^ b[i];
  }
  return c === 0;
}
```

### 2. At-Rest AES-256-GCM Encryption
Sensitive credentials (access tokens, app secrets, recipient IDs) are encrypted before writing to D1:
- Cipher: `AES-GCM` with a 256-bit key.
- IV: Cryptographically secure 12-byte (96-bit) random IV per encryption operation via `crypto.getRandomValues(new Uint8Array(12))`.
- Storage Format: `v1:<hex_iv>:<hex_ciphertext_and_tag>`
- **Key Rotation Plan**:
  - The format prefix (`v1:`) indicates the master key version.
  - When rotating keys, a new secret `ENCRYPTION_KEY_V2` is added to Worker Secrets.
  - An administrative migration script reads existing records, decrypts using `v1`, re-encrypts using `v2`, and updates the rows in D1 without downtime.

---

## 6. Authentication Trade-Off Analysis for Single-Tenant Client Deployments (Phase 3)

In a single-tenant deployment where each client has their own Cloudflare Worker instance, selecting the right authentication method is critical. The solution must run within the 10 ms CPU limit and require minimal setup effort from non-technical clients.

| Auth Option | Mechanism | Free Worker CPU Overhead | Non-Technical Client Setup Effort | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Email Magic Link (OTP)** | Client inputs their email. Worker sends a 6-digit OTP or signed token via transactional email (Resend / Cloudflare Email Routing). Worker validates signed HMAC token. | **< 0.5 ms CPU** (Native Web Crypto HMAC) | **Extremely Low (1–2 minutes)**: The client simply enters their admin email during the initial deploy wizard. No external developer consoles or domain verification needed. | **RECOMMENDED PRIMARY CHOICE** |
| **Google OAuth 2.0 (OpenID Connect)** | User clicks "Sign in with Google". Worker verifies the ID token or exchanges code with Google OAuth endpoint. | **~1.5 ms CPU** (JWT signature check or tokeninfo fetch) | **High (15–30 minutes)**: Requires the client (or deployer) to create a Google Cloud Console project, configure the OAuth Consent Screen, create OAuth 2.0 Client Credentials, and configure authorized redirect URIs. Overly complex for a small retail shop or clinic. | Secondary option for enterprise/advanced clients. |
| **Cloudflare Zero Trust Access** | Cloudflare edge intercepts requests to `/*` and forces authentication via Email PIN or IdP before hitting the Worker. | **0 ms CPU** (Handled entirely before Worker execution) | **Medium-High (10–20 minutes)**: Requires setting up a Cloudflare Zero Trust organization, adding an Access Application, configuring policies, and requires a custom domain (does not work cleanly on pure `*.workers.dev`). | Excellent optional upgrade if the client already has a custom domain on Cloudflare. |

### Conclusion for Phase 3:
OmniFlow will implement **Email Magic Link / One-Time Passcode (OTP)** as the default out-of-the-box authentication mechanism. It requires zero cloud developer console setup, executes in < 0.5 ms of CPU time, and works out-of-the-box on both `*.workers.dev` and custom domains.

---

## 7. Webhook Event Data Retention & Purge Architecture

To guarantee the D1 database stays within its 500 MB free storage limit and prevent PII accumulation:
1. **Retention Expiration Timestamp**: Every event row written to `webhook_events` calculates `retention_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days')`.
2. **Purge Worker / Scheduled Cron**:
   - A Cloudflare Workers Cron Trigger (e.g. `0 3 * * *` - runs daily at 3:00 AM UTC) executes:
   ```sql
   DELETE FROM webhook_events WHERE retention_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
   ```
   - This keeps table size steady and well within free tier limits.
