# OmniFlow Stage 2 — Premium Dashboard & Deployment Guide

**Stage 2 delivers the complete "Evergreen Mist" dashboard UI** on top of the verified Phase 1/2 webhook + automation engine, plus the new admin endpoints it needs. Everything below is written for Windows PowerShell, but the same commands work on macOS/Linux.

---

## 1. What is new in Stage 2

### Dashboard UI (apps/web — React SPA, English UI)
| Area | What you can do |
| :--- | :--- |
| **Login** | Password-protected admin access (`ADMIN_PASSWORD` secret). Session lives only in the current browser tab. |
| **Dashboard** | Live counters (channels, rules, conversations, needs-human, messages today), 7-day inbound/outbound chart, channel health list. |
| **Inbox** | All customer chats in one place. Filter pills **All chats / Needs human (count)**, per-channel filters, search. Chat view with customer/auto-reply/staff bubbles, delivery ticks, simulated-reply chips, failure reasons, **24-hour care window banner**, staff reply composer (Enter to send), **Take over / Assign to me / Return to auto mode** handover controls. |
| **Customers** | Everyone who ever messaged you — masked phone numbers only, chat counts, last-seen. |
| **Automatic Replies** | Create/edit/pause/delete keyword rules with **English + Malayalam replies**, keyword chips, matching style (contains / exact / starts with), priority (0–1000), fallback rules. |
| **Channels** | **Multi-account** setup wizards for **WhatsApp / Instagram / Messenger** — step-by-step requirements, where to find each ID & token, encrypted token storage, webhook callback URLs with copy buttons, verify-token status check, edit/rename/rotate token/disconnect/remove. |
| **Settings** | Automation status (Off / Test / Live), dry-run safety brake, test-mode recipients allowlist, preferred language, business hours + timezone, handover auto-resume timeout, emergency stop notes. |

### Mobile-friendly
- **< 1024 px**: thumb-friendly bottom navigation (Inbox, Customers, Replies, Channels, Settings) + compact top header.
- **≥ 1024 px**: full sidebar navigation.
- Inbox switches between split view (desktop) and full-screen thread (mobile).

### New admin API endpoints (apps/api — protected by `X-Admin-Password`)
| Endpoint | Purpose |
| :--- | :--- |
| `POST /api/v1/admin/conversations/:id/reply` | Staff reply — channel-aware dispatch (WhatsApp/IG/Messenger), respects dry-run. |
| `POST /api/v1/admin/conversations/:id/read` | Marks conversation read (unread = 0). |
| `PUT /api/v1/admin/accounts/:id` | Rename / rotate token / connect-disconnect an account. |
| `GET /api/v1/admin/webhook-info` | Callback URLs + secret-presence flags (never leaks the token value). |
| `GET /api/v1/admin/contacts` | Customer directory (masked PII only). |
| `GET /api/v1/admin/stats/daily` | 7-day inbound/outbound series for the dashboard chart. |
| `GET /` (Worker root) | Now serves the dashboard SPA via the Static Assets binding. |

### Fixes carried into Stage 2
- `scripts/seed.ts` syntax error fixed (Instagram/Messenger fallback rules were outside their template literals — seeding crashed). Seeding now writes **5 rules**: Greeting, Pricing, WhatsApp fallback, Instagram fallback, Messenger fallback.
- `npm run d1:migrate:*` now passes `--config apps/api/wrangler.jsonc`, so migrations apply correctly from the repo root.
- SPA is served by the Worker (static assets fallback added) — `/login`, `/inbox`, `/replies`… all resolve on the deployed URL.

### Test suite
**112 automated tests, 12 suites, all passing** (`npm test`) — including 17 new Phase 3 tests covering staff reply (simulated + real dispatch + failure mapping), mark-read, account updates (token never returned), webhook-info secret safety, contacts PII masking, and tenant-scoped daily stats.

---

## 2. Run the dashboard locally (Windows)

```powershell
# 1. Install everything
npm install

# 2. Local secrets — copy the template and fill the generated keys
Copy-Item .env.example apps/api/.dev.vars
node -e "console.log(crypto.randomBytes(32).toString('base64'))"   # -> ENCRYPTION_KEY
node -e "console.log(crypto.randomBytes(32).toString('hex'))"      # -> LOOKUP_HASH_SECRET
# Paste both into apps/api/.dev.vars, and choose an ADMIN_PASSWORD there too.

# 3. Local database
npm run d1:migrate:local
npm run seed:local      # prompts for Phone Number ID + token (any dummy values work locally)

# 4. Build the dashboard once (Worker serves apps/web/dist)
npm --workspace=apps/web run build

# 5. Start the Worker (API + dashboard together)
npm run dev
# -> open http://localhost:8787  (login with your ADMIN_PASSWORD from .dev.vars)
```

> Optional live-reload frontend development: run `npm run dev` (API) in one terminal and `npm --workspace=apps/web run dev` in another — Vite proxies `/api` to the Worker on port 8787.

---

## 3. Permanent Cloudflare deployment

```powershell
# 1. Log in and create the production D1 database
npx wrangler login
npx wrangler d1 create omniflow-db
# Copy the returned database_id into apps/api/wrangler.jsonc -> d1_databases[0].database_id

# 2. Apply migrations to the remote database
npm run d1:migrate:remote

# 3. Production secrets (values are never stored in code)
npx wrangler secret put ADMIN_PASSWORD --config apps/api/wrangler.jsonc
npx wrangler secret put ENCRYPTION_KEY --config apps/api/wrangler.jsonc
npx wrangler secret put LOOKUP_HASH_SECRET --config apps/api/wrangler.jsonc
npx wrangler secret put META_APP_SECRET --config apps/api/wrangler.jsonc
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN --config apps/api/wrangler.jsonc

# 4. Seed the tenant + starter rules (encrypts the token before writing to D1)
npm run seed:remote

# 5. Build the dashboard and deploy Worker + SPA together
npm --workspace=apps/web run build
npx wrangler deploy --config apps/api/wrangler.jsonc
# Wrangler prints your permanent URL: https://omniflow-api.<your-subdomain>.workers.dev
```

Open the URL, log in with your `ADMIN_PASSWORD`, and continue with the **Channels → Add channel** wizard.

---

## 4. Meta setup — test number first, real number later

### Step A — WhatsApp webhook (Meta Developer App)
1. [developers.facebook.com](https://developers.facebook.com) → your App → **WhatsApp** → **Configuration** → Edit **Webhook**.
2. Callback URL: `https://omniflow-api.<your-subdomain>.workers.dev/api/v1/webhooks/whatsapp`
3. Verify token: the exact value you stored in `META_WEBHOOK_VERIFY_TOKEN` (Channels page shows whether it is configured).
4. **Verify and Save** → then **Webhook fields → Manage → subscribe `messages`**.

### Step B — Test number (always first)
1. **WhatsApp → API Setup** → copy the **Phone number ID** of the test number.
2. Channels → **Add channel → WhatsApp** → paste the Phone Number ID + a System User token → Save.
3. Under **"To" → Manage phone number list**, add your personal WhatsApp number and verify the 6-digit code.
4. In **Settings** keep automation in **Test** mode (dry run on) → send `hi` or `വില` from your phone → watch the simulated replies appear in the Inbox.
5. When confident: Settings → **Test**, dry run **off**, allowlist = your number → real replies arrive on WhatsApp.
6. Only then switch to **Live** for real customers.

### Step C — Real WhatsApp number
1. Add your business phone number in **WhatsApp → API Setup** and verify it (OTP by phone/SMS).
2. Channels → **Add channel → WhatsApp** with the **new** Phone Number ID + the same System User token. (Multiple accounts are supported — keep the test number connected if you like.)
3. Repeat the dry-run → live sequence above.

### Instagram & Messenger
Use the same wizard: Instagram needs a **Professional account linked to a Facebook Page** + `instagram_manage_messages`; Messenger needs a **Facebook Page** + Page token with `pages_messaging`. Webhook callback URLs for each platform are shown on the Channels page. Customers must message you first (24-hour window rules apply on all three platforms).

---

## 5. Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Login says "ADMIN_PASSWORD is not configured" | `npx wrangler secret put ADMIN_PASSWORD --config apps/api/wrangler.jsonc` (or add to `apps/api/.dev.vars` locally), then reload. |
| Replies show "Simulated" | Dry run is ON (Settings). Turn it off when Meta webhooks + test number are verified. |
| Outbound failed: "access token expired" (error 190) | Channels → Edit account → paste a fresh System User token (they do not expire; user tokens do). |
| Outbound failed: "care window expired" (131047) | Customer has not written in 24 h — they must message first, or send an approved template (not implemented yet). |
| No messages arriving at all | Check webhook subscription (`messages` field), verify-token match, and that the account is **Connected** on the Channels page. |
| Emergency stop | Settings → Automation status **Off** → Save. Zero automatic replies; inbox keeps recording. |

---

## 6. Safety model (unchanged from Phase 1/2)

- Tokens & platform IDs encrypted with **AES-256-GCM** before touching D1; UI only ever shows `...last4` previews and masked phone numbers.
- All admin routes fail **closed** without `ADMIN_PASSWORD` (503) and use timing-safe comparison.
- Webhooks verify Meta HMAC-SHA256 before parsing; unknown accounts, duplicates and reply-dedupe violations are skip+log.
- Dry-run never contacts real recipients — simulated rows are clearly labelled in the inbox and database (`is_simulated = 1`).
