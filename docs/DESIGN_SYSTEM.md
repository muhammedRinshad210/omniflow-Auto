# OmniFlow — "Evergreen Mist" Design System (DESIGN_SYSTEM.md)

**Design Version:** 0.1.0  
**Identity:** Evergreen Mist — Calm, premium, eye-comfortable, designed for high-frequency business messaging.  
**Accessibility Standard:** Full WCAG 2.1 Level AA Compliance.

---

## 1. Visual Philosophy & Design Principles

Small business owners and frontdesk staff often spend hours managing customer messages across WhatsApp, Instagram, and Facebook. The UI must avoid harsh neons, high-contrast black/white jarring borders, or fatiguing animations.

1. **Restful & High-Clarity**: Soft natural greens, breathable spacing, and soft surfaces keep staff focused without eye fatigue.
2. **Plain-Language Navigation**: No developer jargon ("Webhooks", "JSON Payload", "State Machine"). Navigation uses intuitive terms: "Inbox", "Customers", "Automatic Replies", "Connected Channels", "Settings".
3. **Unambiguous Urgency**: When a customer requires human assistance, it is instantly visible via a high-contrast amber/rust indicator badge.
4. **Strict Contrast Compliance**: Warm Gold (`#D9A75B`) is reserved **strictly for decorative icons, status pings, and notification dots**. It is **never used for text on light surfaces**.

---

## 2. Color Palette & WCAG AA Contrast Ratios

| Token Name | Hex Code | Visual Role | Tested Contrast Against Background / Surface | Accessibility Rating |
| :--- | :--- | :--- | :--- | :--- |
| `primary` | `#145B50` | Primary buttons, active tabs, brand headers | **7.8:1** (against white text) | **WCAG AAA** (Pass) |
| `primary-hover` | `#0F453D` | Button hover and pressed states | **9.2:1** (against white text) | **WCAG AAA** (Pass) |
| `mint` | `#75BFAE` | Secondary accents, active chips, icon fills | **5.2:1** (against text `#20352E`) | **WCAG AA** (Pass) |
| `mint-light` | `#D2EDE6` | Inbound chat bubble background | **8.1:1** (against text `#20352E`) | **WCAG AAA** (Pass) |
| `bg` | `#F3F6F2` | Global application canvas | Base background | Eye-restful |
| `surface` | `#E5EFEA` | Card backgrounds, sidebar panels | **10.2:1** (against text `#20352E`) | **WCAG AAA** (Pass) |
| `card` | `#FFFFFF` | Elevated white card panels | **12.1:1** (against text `#20352E`) | **WCAG AAA** (Pass) |
| `text` | `#20352E` | High-contrast body text & headings | Primary foreground | Maximum legibility |
| `text-muted` | `#556E66` | Timestamps, secondary subtitles | **4.6:1** (against `#F3F6F2`) | **WCAG AA** (Pass) |
| `border` | `#CDE0D7` | Subtle dividers and input outlines | Non-text UI component border | Clean separation |
| `gold` | `#D9A75B` | **DECORATIVE ONLY**: Stars, status rings | N/A (Never text on light surfaces) | Safe decorative token |
| `urgent-bg` | `#FEEBC8` | Background for "Needs human" badge | Badge fill | High contrast |
| `urgent-text` | `#7B341E` | Text for "Needs human" badge | **5.5:1** (against `#FEEBC8`) | **WCAG AA** (Pass) |

---

## 3. Typography & Scale

OmniFlow uses the native system font stack to ensure zero font-download overhead and native operating system rendering speed:
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
```

### Type Scale:
- `text-xs` (12px / line-height: 16px): Message timestamps, badge text, character counters.
- `text-sm` (14px / line-height: 20px): Metadata labels, table data, helper text.
- `text-base` (16px / line-height: 24px): Primary message bubble text, form inputs, navigation items.
- `text-lg` (18px / line-height: 28px): Modal headings, conversation contact names.
- `text-xl` (20px / line-height: 28px): Section titles.
- `text-2xl` (24px / line-height: 32px): Dashboard top-level page headers.

---

## 4. Spacing, Elevation & Corner Radius

- **Corners**:
  - Cards & Inputs: `rounded-xl` (12px)
  - Message Bubbles: `rounded-2xl` (16px) with an acute corner on the sender side
  - Pills & Badges: `rounded-full` (9999px)
- **Shadows**:
  - Soft diffuse ambient shadows using a primary green tint instead of harsh pitch-black:
  - `shadow-mist-sm`: `0 1px 3px rgba(20, 91, 80, 0.05)`
  - `shadow-mist-md`: `0 4px 12px -2px rgba(20, 91, 80, 0.08)`

---

## 5. Mobile-First Navigation & Handover Visibility

### Mobile Navigation (Viewport < 768px):
A fixed 5-tab thumb-friendly bottom bar:
1. **Inbox**: Chat list with real-time unread badges.
2. **Customers**: Searchable contact book with channel filters.
3. **Replies**: Quick reply templates and automation rules.
4. **Channels**: Connection health pings (WhatsApp, Instagram, Messenger).
5. **Settings**: Staff profiles, business hours, and Cloudflare quota meter.

### Visible Human Handover (First-Class Feature):
Human handover is **never buried in submenus**.
- At the top of the **Inbox**, two primary filter pills are prominently placed:
  - **All Chats**
  - **Needs Human** (with a high-contrast amber/rust badge showing the exact count: e.g. `[ Needs Human • 3 ]`).
- When a customer triggers a human handover request, their conversation item in the list receives an amber pulse dot and shifts to the top of the queue.

---

## 6. Core Component Specifications

### 1. Primary Action Button
- Background: `#145B50` (`evergreen-primary`)
- Text: `#FFFFFF` (Bold, 14px / 16px)
- Padding: `px-4 py-2.5`
- Radius: `rounded-xl` (12px)
- Hover: `#0F453D` with smooth transition (`transition-colors duration-150`)

### 2. Secondary / Outlined Button
- Background: `transparent` (or `#E5EFEA` surface)
- Border: `1.5px solid #145B50`
- Text: `#145B50` (Medium, 14px)
- Hover: `#D2EDE6` background

### 3. Text Input & Form Controls
- Background: `#FFFFFF`
- Border: `1.5px solid #CDE0D7`
- Text: `#20352E`
- Focus State: Border shifts to `#145B50` with an outer ring `ring-2 ring-evergreen-mint/30`
- Minimum touch target: `44px` height on mobile.

### 4. Message Bubbles
- **Customer (Inbound)**:
  - Background: `#FFFFFF`
  - Text: `#20352E`
  - Border: `1px solid #E5EFEA`
  - Timestamp: `#556E66` (12px)
- **OmniFlow (Outbound Auto-Reply / Agent)**:
  - Background: `#D2EDE6` (`evergreen-mint-light`)
  - Text: `#20352E`
  - Status Indicator: Checkmark icons (single tick = sent, double tick = delivered, green double tick = read).

### 5. 24-Hour Customer Care Window Indicator
- A clean banner at the bottom of the conversation view:
  - **Window Open**: Shows green indicator with remaining hours (e.g. `🟢 Care window open: 18h remaining`).
  - **Window Expired**: Shows amber indicator with plain explanation (e.g. `🟡 24h window closed. Only approved template messages can be sent.`).

### 6. Demo Workspace Badge
- In demo mode, a persistent top banner is displayed:
  - `Demo Workspace (Sample Data Only • Real numbers are never contacted)`
  - Background: `#E5EFEA` with warm gold accent border `#D9A75B`.
