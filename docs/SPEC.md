# OmniFlow — Product Specification (SPEC.md)

**Document Version:** 0.1.0  
**Status:** Approved for Phase 0  
**Target Platform:** Cloudflare Workers + D1 + Static Web Assets (Free Tier Optimized)

---

## 1. Vision & Core Philosophy

**OmniFlow** is a modern, standalone multi-channel messaging automation platform designed specifically for small businesses. It connects WhatsApp Business Cloud API, Instagram Messaging, and Facebook Messenger into a unified, reliable, and calm inbox and automation engine.

### Core Philosophy
1. **Zero Recurring SaaS Subscriptions**: Instead of bleeding small businesses with \$50–\$200/month SaaS subscriptions, OmniFlow is designed for a one-time setup fee plus an optional annual support/maintenance renewal.
2. **Client Ownership & Single-Tenant Isolation**: Each client runs their own instance inside **their own free Cloudflare account**. They retain 100% data sovereignty, pay Meta directly for conversation fees, and never share a database with other businesses.
3. **No-Nonsense Usability**: Designed for non-technical business owners, receptionists, and support staff. Plain-language error messages, mobile-first navigation, and zero developer jargon.
4. **Cloudflare Free-Tier Native**: Architected to operate smoothly within Cloudflare's permanent free tier (100,000 requests/day, 5M D1 row reads/day, 100k D1 row writes/day, 500 MB DB size), with graceful degradation and clear usage alerts.

---

## 2. Target Users & Personas

| Persona | Role | Primary Goals | Key Frustrations with Existing Tools |
| :--- | :--- | :--- | :--- |
| **Priya** (Business Owner / Clinic Manager) | Manages client inquiries & bookings | Quick automated replies during off-hours; reliable WhatsApp routing; low ongoing software costs. | Expensive monthly SaaS fees; complex Zapier zaps that break silently; messy multi-tab management. |
| **Rahul** (Frontdesk / Support Staff) | Handles incoming inquiries on mobile and desktop | Clear inbox view; instant notification when a customer needs a human agent; quick reply templates. | Cluttered dashboards; accidental bot loops; missed WhatsApp 24-hour customer service windows. |
| **Consultant / Developer** (Deployer) | Sets up OmniFlow for small businesses | Repeatable deploy script (< 45 min setup); clear checklist for Meta App configuration; zero infrastructure headaches. | Multi-service complexity; managing AWS/VPS servers; handling tricky database backups. |

---

## 3. Business Model & Economics

- **Current State**: Free development, testing, and live client demonstrations.
- **Commercial Model**:
  - **One-time Setup Fee**: Charged for setting up the client's Meta Business account, Cloudflare account, and deploying their custom OmniFlow instance.
  - **Optional Annual Support Contract**: Fixed yearly fee covering Meta API version upgrades, backup audits, and priority troubleshooting.
  - **Zero Monthly Software Subscription**: The software itself incurs no monthly licensing charge.
  - **Meta Direct Billing**: Meta conversation charges (WhatsApp Business messaging fees) are billed directly to the client's Meta Business Manager credit card. OmniFlow never acts as a billing middleman.

---

## 4. Multi-Tenant Ready Single-Tenant Architecture

- **Default Mode: Single-Tenant**: Each deployment serves a single business entity with `tenant_id = 'ten_client_xxxx'`.
- **SaaS Ready**: Every D1 table strictly enforces `tenant_id` and foreign key relationships. If a hosted multi-tenant SaaS mode is launched in the future, the codebase and schema require zero structural rewrite.
- **Demo Workspace Mode**:
  - The deploy kit can seed a dedicated demo workspace (`is_demo = 1`).
  - Contains sanitized sample chats, simulated Malayalam and English automation rules, and sample customer contacts (no real phone numbers).
  - Prominently labeled with a gold "Demo Workspace" indicator banner.
  - Easily purgeable via a single SQL script or dashboard button, and **never seeded in a real client production deployment**.

---

## 5. Detailed Phase Roadmap

```
Phase 0: Foundation, Architecture, D1 Schema & Skeleton
   │
   ▼
Phase 1: WhatsApp MVP (Webhook verify, HMAC, dedupe, auto-reply, delivery status)
   │
   ▼
Phase 2: Automation Engine (Rules, Malayalam/English triggers, 24h window, handover)
   │
   ▼
Phase 3: Web Dashboard & Demo Workspace (Auth, mobile inbox, handover queue, demo mode)
   │
   ▼
Phase 4: Instagram Messaging (Direct Messages only via Meta Graph API)
   │
   ▼
Phase 5: Facebook Messenger (Page Direct Messages only via Meta Graph API)
   │
   ▼
Phase 6: Client Deploy Kit & Usage Metering (Repeatable setup, Cloudflare quota alerts)
   │
   ▼
Phase 7: Hardening & Enterprise Quality (Security audit, e2e tests, backup scripts)
   │
   ▼
Phase 8: Small Business Pilot (Live field deployment with 1–2 real businesses)
```

### Phase Details

#### Phase 0: Foundation & Architecture (Current)
- Monorepo skeleton with strict TypeScript, Hono API Worker, and shared package.
- Lean D1 migration (`0001_initial_schema.sql`) enforcing tenant scoping, AES-GCM encrypted recipient identifiers, keyed HMAC lookup hashes, nullable outbound message IDs, dedupe keys, and ISO-8601 UTC timestamps with Z.
- Comprehensive documentation: `SPEC.md`, `RULES.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `README.md`.
- Automated test suite validating `GET /health` and D1 schema migration integrity.

#### Phase 1: WhatsApp MVP
- Cloudflare webhook receiver for Meta WhatsApp Cloud API (`POST /api/v1/webhooks/whatsapp` & `GET` challenge).
- Web Crypto HMAC-SHA256 verification using raw request buffer.
- Event deduplication via `dedupe_key`.
- Ingestion pipeline with immediate HTTP 200 response (< 40ms) + `executionCtx.waitUntil()` background processing.
- First automatic response delivery via Meta Graph API.
- Message status updates (sent, delivered, read, failed).

#### Phase 2: Shared Automation Engine
- Rule matching engine evaluating priority, channel applicability, and schedule (business hours).
- Keyword triggers supporting Malayalam and English phrasing (e.g., `["price", "rate", "cost", "വില", "ചിലവ്"]`).
- 24-hour customer care window guard (prevents Meta API 131047 errors by blocking non-template outbound messages when the window is closed).
- Human handover state machine (`bot` -> `human_requested` -> `human_assigned`). When a customer asks for a human or a rule fails, the conversation status is set to `human_requested`, bot replies pause, and an alert is triggered.

#### Phase 3: Web Dashboard & Demo Workspace
- Single-tenant authentication (Magic Link via email OTP, evaluated for lowest client setup overhead).
- Mobile-first responsive UI built with Tailwind ("Evergreen Mist" palette).
- Real-time inbox with dedicated **"Needs human"** filter and prominent count badge.
- Conversation thread viewer with WhatsApp-style bubbles, delivery ticks, and customer care window timer.
- Visual automation rule builder and channel connection status panel.
- Built-in Demo Workspace toggle (`is_demo = 1`) with sanitized sample chats.

#### Phase 4: Instagram Messaging (Direct Messages Only)
- Instagram Messaging Webhook adapter for incoming Direct Messages.
- Graph API outbound DM client.
- Channel normalization into shared event format (`ChannelType: 'instagram'`).
- Note: Story mentions, live comment auto-replies, and media tagging are explicitly deferred to post-pilot phases.

#### Phase 5: Facebook Messenger (Direct Messages Only)
- Facebook Page Messaging Webhook adapter for incoming Page DMs.
- Graph API outbound client.
- Channel normalization into shared event format (`ChannelType: 'messenger'`).
- Note: Public post comment triggers and ads lead generation forms are explicitly deferred.

#### Phase 6: Client Deploy Kit & Usage Metering
- Repeatable command-line deployment kit (`npm run deploy:client`) with interactive CLI prompts.
- Non-technical deployment checklist documentation.
- Cloudflare free-tier usage monitoring screen: daily requests, D1 row reads/writes, and storage headroom alerts.

#### Phase 7: Hardening & Enterprise Quality
- Comprehensive end-to-end webhook simulation tests.
- Security and OWASP review: constant-time HMAC check, token re-encryption, PII scrub verification.
- Automated D1 SQLite snapshot backup script using Cloudflare Time Travel API.
- Error monitoring and alerting.

#### Phase 8: Small Business Pilot
- Deployment in 1–2 real small businesses (e.g. clinic, travel agency, or retail shop).
- Direct staff observation, mobile usability feedback, and bug fixes.
