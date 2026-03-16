# Deep Space UI Redesign

Full visual overhaul of The Other Dude's frontend — replacing the generic shadcn/slate/cyan aesthetic with a distinctive identity built for network engineers and MSPs.

## Problem

The current UI is visually indistinguishable from every other AI-generated dashboard. The slate/cyan color scheme, default shadcn component styling, and feature-organized navigation are so generic that other MikroTik dashboard projects (e.g., MikroDash) look like the same app. TOD has no visual identity.

## Goals

- **Distinctive identity** — you should never confuse TOD with a template
- **Functional clarity** — DigitalOcean/Hetzner energy, not Unifi complexity
- **WCAG AA compliance** — 4.5:1 text contrast, 3:1 UI elements, both modes
- **Both modes polished** — dark is the primary identity, light is equally considered
- **Desktop-first** — responsive works, but optimized for laptop/desktop workflows

## Design Direction: Deep Space

Dark but not cold. Deep blue-blacks instead of gray-slate. Indigo/violet accent instead of cyan. Subtle gradients for depth. Typography and spacing create hierarchy instead of colored cards and heavy borders.

Reference points: DigitalOcean, Hetzner, Linode for functional clarity. cPanel for density that works. Not Unifi. Not generic shadcn.

---

## 1. Color System

### Dark Mode (Primary)

| Token | Value | Usage |
|-------|-------|-------|
| background | `#111113` | Page background, near-black with warm undertone |
| surface | `#141420` | Cards, panels, elevated content areas |
| elevated | `#1a1a2e` | Inputs, hover states, KPI card gradient base |
| border | `rgba(255,255,255,0.06)` | Default borders — thin, not heavy |
| border-bright | `#24243d` | Emphasized borders, section dividers |
| text-primary | `#e4e4ed` | Headings, device names, primary content |
| text-secondary | `#8a8aa0` | Metadata, secondary labels, IP addresses (4.6:1 on background) |
| text-muted | `#62627f` | Placeholders, column headers, tertiary info (3.2:1 on background) |
| accent | `#818cf8` | Primary interactive color (indigo-400) |
| accent-hover | `#6366f1` | Hover/pressed state (indigo-500) |
| accent-subtle | `rgba(99,102,241,0.15)` | Active nav, selected states, ghost-fill buttons |

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| background | `#fafafe` | Page background, barely-tinted white |
| surface | `#ffffff` | Cards, panels |
| elevated | `#f0f0f8` | Inputs, hover states — blue-violet undertone |
| border | `rgba(0,0,0,0.08)` | Default borders |
| border-bright | `#dcdce8` | Emphasized borders |
| text-primary | `#111113` | Headings, primary content |
| text-secondary | `#52526b` | Metadata, secondary labels |
| text-muted | `#8585a0` | Placeholders, disabled text |
| accent | `#5558e6` | Primary interactive color (4.6:1 on white, 4.4:1 on background) |
| accent-hover | `#4f46e5` | Hover/pressed state (indigo-600) |
| accent-subtle | `rgba(99,102,241,0.1)` | Active states |

### Status Colors

| Status | Dark | Light | Meaning |
|--------|------|-------|---------|
| success | `#22c55e` | `#16a34a` | Online, healthy |
| warning | `#f59e0b` | `#d97706` | Degraded, attention needed |
| error | `#ef4444` | `#dc2626` | Offline, critical |
| info | `#3b82f6` | `#2563eb` | Informational |

### Gradient Pattern

KPI cards and elevated surfaces use a subtle directional gradient for depth:
```
Dark:  linear-gradient(135deg, #1a1a2e 0%, #16162a 100%)
Light: linear-gradient(135deg, #f8f8ff 0%, #f0f0f8 100%)
```

Status indicator dots use a subtle glow:
```
box-shadow: 0 0 6px rgba({color}, 0.3)
```

---

## 2. Typography

### Fonts

- **UI text:** Manrope — geometric, semi-rounded, modern without being trendy
- **Data values:** IBM Plex Mono — wider and more readable than most monospaces, designed for infrastructure UIs
- **Fallbacks:** system-ui, -apple-system, sans-serif (UI) / ui-monospace, monospace (data)

### Type Scale

| Role | Size | Weight | Font | Extra |
|------|------|--------|------|-------|
| Page title | 18px | 600 | Manrope | letter-spacing: -0.3px |
| Section heading | 14px | 600 | Manrope | — |
| Body text | 13px | 500 | Manrope | Nav items, device names |
| Small text | 11px | 500 | Manrope | Metadata, model names |
| Micro label | 10px | 600 | Manrope | uppercase, letter-spacing: 1.2px |
| Mono large | 22-24px | 500 | IBM Plex Mono | tabular-nums, KPI values |
| Mono inline | 12px | 400 | IBM Plex Mono | tabular-nums, IPs/percentages |
| Mono small | 11px | 400 | IBM Plex Mono | tabular-nums, table cells |

### Principles

- No text larger than 18px — this is a dense tool, not a marketing site
- Monospace only for actual data values (numbers, IPs, percentages, durations)
- Uppercase micro labels for section/column headers create hierarchy without size
- `font-variant-numeric: tabular-nums` on all monospace so numbers align

### Font Loading

Self-host both fonts via `@fontsource/manrope` and `@fontsource-variable/ibm-plex-mono` npm packages. No Google Fonts CDN — the app may run on air-gapped or restricted networks. Import only the weights used (400, 500, 600, 700 for Manrope; 400, 500 for IBM Plex Mono).

### Transitions

All interactive state changes (hover, focus, active, color-scheme toggle): `150ms ease`. Sidebar collapse: `200ms ease`. Dialog enter/exit: `150ms ease`. Respect `prefers-reduced-motion` by disabling all transitions/animations.

---

## 3. Component Language

### Border Radius
- Cards/panels: 8px
- Buttons/inputs/pills: 6px
- Status dots/avatars: 50%
- No `rounded-full` pill buttons

### Depth Model
- **Borders over shadows** — zero box-shadows on cards. Thin borders for structure.
- Dark: `rgba(255,255,255,0.06)` default, `#24243d` emphasized
- Light: `rgba(0,0,0,0.08)` default, `#dcdce8` emphasized

### Buttons
- **Primary:** Ghost-fill — `background: accent-subtle; color: accent`. Solid indigo only for critical CTAs (e.g., "Add device" gets `background: accent; color: white`).
- **Secondary:** Border-only — `border: 1px solid border; color: text-secondary`
- **Destructive:** Ghost-fill in red — same pattern as primary but with error tokens
- All 6px radius, no pill shapes
- All button colors derive from mode-aware tokens — no hardcoded values

### Inputs
- Background: `#1a1a2e` (dark) / `#f0f0f8` (light)
- Border: thin, default color
- Focus: border-color changes to accent — no ring glow
- Radius: 6px
- Placeholder: text-muted color

### Tables
- No alternating row colors
- Thin bottom borders: `rgba(255,255,255,0.06)` (dark) / `rgba(0,0,0,0.06)` (light) — uses border token, intentionally subtle
- Column headers: uppercase micro labels in text-muted
- Status dots inline, not colored row backgrounds
- Monospace for data columns (IP, CPU, uptime)

### Tabs/Pills
- Active: ghost-fill accent background + accent text color
- Inactive: plain muted text, no background
- No underlines or heavy active indicators

### Dialogs/Modals
- Surface background with thin border
- Backdrop: `rgba(0,0,0,0.6)` with subtle blur
- Same 8px radius as cards

---

## 4. Layout Structure

### Context Strip (Top Bar — 36px height)

Always-visible horizontal bar providing at-a-glance status:

- **Left:** Org switcher — icon + name + dropdown chevron. Adaptive: prominent for multi-org MSPs, minimal for single-org users. Separated from status indicators by a thin vertical border.
- **Center:** Live status indicators — clickable items that filter/navigate:
  - Red dot + "2 down" (navigates to offline devices)
  - Amber dot + "4 degraded" (navigates to degraded devices)
  - "WiFi OK" or "WiFi 3 issues" (navigates to wireless view)
  - "BW 4.2G" in monospace (navigates to traffic view)
- **Right:** Command palette shortcut (⌘K), connection status dot, user avatar

The strip replaces the need for a separate alerts page as the primary "is anything broken" indicator.

**Data source:** The strip derives its counts from the existing fleet summary API (`metricsApi.fleetSummary`) which already returns device status counts and aggregate metrics. No new API endpoint needed — the strip subscribes to the same React Query cache that the dashboard uses. Status updates arrive via the existing WebSocket device-status subscription. WiFi and bandwidth indicators aggregate from the same data source.

### Sidebar (180px, collapsible to 56px icon-only)

Three sections organized by user intent:

**Fleet** (monitoring — "what's happening")
- Overview — dashboard with KPIs, fleet health
- Devices — full device table with search/filter
- Wireless — AP status, client counts, signal quality
- Traffic — bandwidth charts, top talkers

**Config** (changes — "do something")
- Editor — live config editor with menu tree
- Templates — config templates, push wizard
- Firmware — version management, upgrades

**Admin** (management — "who and how")
- Users — user management, roles
- Audit Log — action history
- Settings — tenant settings, alert rules, notifications

Section labels: uppercase micro labels in muted text. Active nav item: ghost-fill accent background. Inactive: plain muted text.

Version identifier at bottom: `TOD v9.5` in mono micro text.

### Main Content Area

- Full width of remaining space
- 20px padding
- Page header: title (18px semibold) + subtitle (11px muted) left, action buttons right
- KPI cards in a row below header where applicable
- Primary content (tables, charts, forms) below KPIs

---

## 5. Responsive Strategy

Desktop-first. Mobile works in a pinch.

- **Context strip:** Collapses to thin bar with alert count badge on mobile. Tap to expand.
- **Sidebar:** Slide-out drawer via hamburger on mobile.
- **KPI cards:** 4-col → 2-col (tablet) → 1-col (phone)
- **Device table:** Switches to card/list view on phone (no horizontal scroll tables)
- **Touch targets:** Minimum 44px height on interactive elements (WCAG 2.5.8)
- **Type scale:** No changes needed — 11-13px body is native mobile scale. 10px micro labels stay legible due to uppercase + wide letter-spacing.

---

## 6. Implementation Phases

### Phase 1 — Design Tokens & Foundation
**Risk: Low | Impact: High | Disruption: Minimal**

- Replace HSL color tokens in `index.css` with Deep Space palette (dark + light)
- Swap Geist for Manrope + IBM Plex Mono in Tailwind config
- Update custom properties and Tailwind theme mapping
- Add new border/radius/shadow conventions to base styles
- At end of phase: flip the switch — entire app gets new palette and fonts via tokens

Files touched: `index.css`, `tailwind.config.ts`, font imports

### Phase 2 — Component Restyling
**Risk: Low | Impact: High | Disruption: Low**

- Update shared UI primitives: Button, Input, Card, Dialog, Select, Checkbox, Skeleton, Badge, Tabs
- Kill box-shadows, update border radii, implement ghost-fill button style
- Update focus states (border-color change instead of ring glow)
- Changes propagate through entire app via shared components

Files touched: `components/ui/*.tsx`

### Phase 3 — Layout Restructure
**Risk: Medium | Impact: High | Disruption: Medium**

- Replace AppLayout shell — new sidebar structure, new Context Strip header
- Build the Context Strip component with live status indicators
- Reorganize sidebar navigation (Fleet / Config / Admin)
- Update route structure if nav paths change
- Remove old header component

Files touched: `components/layout/AppLayout.tsx`, `Sidebar.tsx`, new `ContextStrip.tsx`, route files

### Phase 4 — Page-Level Polish
**Risk: Low | Impact: Medium | Disruption: Low**

- Refine each page: dashboard KPIs, device table, config editor, alerts integration
- Ensure gradient KPI cards, table styling, form layouts match spec
- Light mode QA pass — verify WCAG contrast on every page
- Fix any spots where old layout assumptions break with new structure

Files touched: page components, dashboard widgets, table components

---

## 7. What This Is Not

- Not a rewrite — same React/Radix/Tailwind stack, same business logic
- Not a mobile redesign — responsive adaptations only
- Not a component library migration — still Radix UI primitives, restyled

**Note:** The Context Strip is the one piece of genuinely new UI (not just restyling). It replaces the current header and surfaces existing data in a new way. Phase 3 should be scoped accordingly — it's the only phase that introduces a new component with its own data needs.

## 8. Success Criteria

- The app is visually unrecognizable compared to its current state
- Nobody mistakes it for a shadcn template or another MikroTik dashboard
- Both dark and light modes pass WCAG AA contrast checks
- The indigo/violet accent and Manrope/IBM Plex Mono pairing create a recognizable identity
- Network engineers see a tool that respects their workflow, not a generic SaaS dashboard
