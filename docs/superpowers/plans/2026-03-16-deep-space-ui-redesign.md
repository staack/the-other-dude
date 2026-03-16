# Deep Space UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic shadcn/slate/cyan aesthetic with the Deep Space design system — new colors, typography, component styling, and layout structure.

**Architecture:** Token-first approach. Phase 1 swaps CSS custom properties and fonts so the entire app transforms via cascade. Phase 2 refines shared UI components. Phase 3 restructures the layout shell (sidebar + context strip). Phase 4 polishes individual pages. Each phase produces a working, committable state.

**Tech Stack:** React 19, Tailwind 3, Radix UI, Manrope font, IBM Plex Mono font, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-16-deep-space-ui-redesign.md`

---

## Chunk 1: Design Tokens & Fonts (Phase 1)

### Task 1: Install new fonts

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/assets/fonts/Manrope-Variable.woff2`
- Create: `frontend/src/assets/fonts/IBMPlexMono-Regular.woff2`
- Create: `frontend/src/assets/fonts/IBMPlexMono-Medium.woff2`

- [ ] **Step 1: Install fontsource packages**

```bash
cd frontend && npm install @fontsource-variable/manrope @fontsource/ibm-plex-mono
```

- [ ] **Step 2: Copy font files to assets for self-hosting**

Copy the woff2 files from node_modules to `src/assets/fonts/`:
```bash
cp node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2 src/assets/fonts/Manrope-Variable.woff2
cp node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2 src/assets/fonts/IBMPlexMono-Regular.woff2
cp node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2 src/assets/fonts/IBMPlexMono-Medium.woff2
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/assets/fonts/Manrope-Variable.woff2 frontend/src/assets/fonts/IBMPlexMono-Regular.woff2 frontend/src/assets/fonts/IBMPlexMono-Medium.woff2
git commit -m "chore: add Manrope and IBM Plex Mono font files"
```

---

### Task 2: Replace @font-face declarations

**Files:**
- Modify: `frontend/src/index.css` (lines 1–16)

- [ ] **Step 1: Replace the Geist @font-face blocks with Manrope + IBM Plex Mono**

Replace lines 1–16 of `frontend/src/index.css`:
```css
@font-face {
  font-family: 'Manrope';
  src: url('./assets/fonts/Manrope-Variable.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'IBM Plex Mono';
  src: url('./assets/fonts/IBMPlexMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'IBM Plex Mono';
  src: url('./assets/fonts/IBMPlexMono-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 2: Update the body font-family rule**

In `frontend/src/index.css`, find the body rule (around line 147) and change:
```css
font-family: 'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
```
to:
```css
font-family: 'Manrope', system-ui, -apple-system, sans-serif;
```

- [ ] **Step 3: Update Tailwind font config**

In `frontend/tailwind.config.ts`, replace lines 67–70:
```typescript
fontFamily: {
  sans: ['Manrope', 'system-ui', '-apple-system', 'sans-serif'],
  mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
},
```

- [ ] **Step 4: Verify fonts load**

Run: `cd frontend && npm run dev`
Open browser, inspect body element — font-family should show Manrope. Check any monospace element (IP address, code) shows IBM Plex Mono.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/tailwind.config.ts
git commit -m "feat(ui): swap Geist for Manrope + IBM Plex Mono"
```

---

### Task 3: Replace color tokens — both modes

**Files:**
- Modify: `frontend/src/index.css` (lines 32–86 light root, lines 88–123 dark)

- [ ] **Step 1: Replace the `:root` (light mode) custom properties**

Find the `:root { }` block in `index.css` (after the `@font-face` declarations) and replace the color custom properties with the Deep Space light mode palette:

```css
  /* ── Deep Space Light Mode ── */
  --background: 240 20% 99%;          /* #fafafe */
  --surface: 0 0% 100%;               /* #ffffff */
  --elevated: 240 33% 96%;            /* #f0f0f8 */
  --border: 0 0% 0% / 0.08;          /* rgba(0,0,0,0.08) */
  --border-bright: 240 14% 88%;       /* #dcdce8 */

  --text-primary: 240 7% 7%;          /* #111113 */
  --text-secondary: 249 14% 37%;      /* #52526b */
  --text-muted: 249 11% 57%;          /* #8585a0 */

  --accent: 239 76% 62%;              /* #5558e6 */
  --accent-hover: 244 75% 58%;        /* #4f46e5 */
  --accent-muted: 239 76% 62% / 0.1;  /* accent-subtle */
  --ring: 239 76% 62%;

  --success: 142 71% 35%;             /* #16a34a */
  --warning: 32 95% 44%;              /* #d97706 */
  --error: 0 72% 51%;                 /* #dc2626 */
  --info: 217 91% 50%;                /* #2563eb */

  --online: 142 71% 35%;
  --offline: 0 72% 51%;
  --unknown: 249 11% 57%;

  --chart-1: 239 76% 62%;
  --chart-2: 142 71% 35%;
  --chart-3: 32 95% 44%;
  --chart-4: 0 72% 51%;
  --chart-5: 280 68% 50%;
  --chart-6: 217 91% 50%;
```

- [ ] **Step 2: Replace the `.dark` custom properties**

Find the `.dark { }` block and replace:

```css
  /* ── Deep Space Dark Mode ── */
  --background: 240 7% 7%;            /* #111113 */
  --surface: 240 22% 10%;             /* #141420 */
  --elevated: 240 28% 14%;            /* #1a1a2e */
  --border: 0 0% 100% / 0.06;        /* rgba(255,255,255,0.06) */
  --border-bright: 240 24% 19%;       /* #24243d */

  --text-primary: 240 14% 91%;        /* #e4e4ed */
  --text-secondary: 249 9% 59%;       /* #8a8aa0 */
  --text-muted: 249 13% 44%;          /* #62627f */

  --accent: 235 91% 74%;              /* #818cf8 */
  --accent-hover: 239 84% 67%;        /* #6366f1 */
  --accent-muted: 239 84% 67% / 0.15; /* accent-subtle */
  --ring: 235 91% 74%;

  --success: 142 69% 58%;             /* #22c55e → 4.8:1 on #111113 */
  --warning: 38 92% 50%;              /* #f59e0b */
  --error: 0 84% 60%;                 /* #ef4444 */
  --info: 217 91% 60%;                /* #3b82f6 */

  --online: 142 69% 58%;
  --offline: 0 84% 60%;
  --unknown: 249 9% 59%;

  --chart-1: 235 91% 74%;
  --chart-2: 142 69% 58%;
  --chart-3: 38 92% 50%;
  --chart-4: 0 84% 60%;
  --chart-5: 280 68% 68%;
  --chart-6: 217 91% 60%;
```

- [ ] **Step 3: Update the `--radius` default**

In the `:root` block, change `--radius` from `0.375rem` to `0.5rem` (8px for cards):
```css
  --radius: 0.5rem;
```

- [ ] **Step 4: Verify color swap**

Run: `cd frontend && npm run dev`
Check both dark and light modes. The entire app should now use the Deep Space palette. Colors will look different but layout is unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(ui): replace color tokens with Deep Space palette"
```

---

### Task 4: Update Tailwind color mappings

**Files:**
- Modify: `frontend/tailwind.config.ts` (lines 11–66 colors, lines 81–87 radius)

- [ ] **Step 1: Fix Tailwind color mappings for alpha tokens**

The existing Tailwind config maps colors as `hsl(var(--token))`. Two tokens now have built-in alpha (`--border` and `--accent-muted`), which breaks the `hsl()` wrapper. Fix these specific mappings in `tailwind.config.ts`:

For `border` and `accent-muted`, change from:
```typescript
border: 'hsl(var(--border))',
'accent-muted': 'hsl(var(--accent-muted))',
```
to:
```typescript
border: 'hsl(var(--border))',
'accent-muted': 'hsl(var(--accent-muted))',
```

Actually, since the CSS values include the alpha channel inside the HSL declaration (e.g., `0 0% 100% / 0.06`), `hsl(var(--border))` produces `hsl(0 0% 100% / 0.06)` which is valid CSS. **No mapping change is needed** — the existing pattern works because CSS `hsl()` accepts the `/` alpha syntax. Verify this renders correctly in the browser after Task 3.

- [ ] **Step 2: Update border radius scale**

In `frontend/tailwind.config.ts`, update the borderRadius section (lines 81–87):
```typescript
borderRadius: {
  sm: '0.25rem',   // 4px
  DEFAULT: 'var(--radius)',  // 8px (cards/panels)
  md: '0.375rem',  // 6px (buttons/inputs)
  lg: 'var(--radius)',       // 8px
  xl: '0.75rem',   // 12px
},
```

- [ ] **Step 3: Commit**

```bash
git add frontend/tailwind.config.ts
git commit -m "feat(ui): update Tailwind theme for Deep Space tokens"
```

---

### Task 5: Add base transition defaults

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add default transitions, tabular-nums, and sidebar animation**

Add to the base styles section of `index.css` (after the scrollbar styles):

```css
/* ── Deep Space transitions ── */
button, a, input, select, textarea,
[role="button"], [role="tab"], [role="menuitem"] {
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease, opacity 150ms ease;
}

/* Sidebar collapse uses a slower transition */
[data-sidebar] {
  transition: width 200ms ease;
}

/* Dialog overlay and content animations */
[data-radix-dialog-overlay] {
  transition: opacity 150ms ease;
}
[data-radix-dialog-content] {
  transition: opacity 150ms ease, transform 150ms ease;
}

/* Monospace always uses tabular numerals for aligned columns */
.font-mono, [class*="font-mono"] {
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(ui): add Deep Space transition defaults"
```

---

## Chunk 2: Component Restyling (Phase 2)

### Task 6: Restyle Button component

**Files:**
- Modify: `frontend/src/components/ui/button.tsx` (50 lines)

- [ ] **Step 1: Update button variants**

Replace the CVA variants in `button.tsx`. Key changes:
- Default (primary): ghost-fill style — `bg-accent-muted text-accent hover:bg-accent/20`
- Solid primary (for critical CTAs): new variant — `bg-accent text-white hover:bg-accent-hover`
- Secondary: border-only — `border border-border text-text-secondary hover:text-text-primary hover:border-border-bright`
- Destructive: ghost-fill red — `bg-error/15 text-error hover:bg-error/20`
- Ghost: `hover:bg-elevated text-text-secondary hover:text-text-primary`
- Outline: `border border-border bg-transparent text-text-secondary hover:bg-elevated`
- All variants: `rounded-md` (6px), remove any `shadow` classes

```typescript
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[hsl(var(--accent-muted))] text-accent hover:bg-accent/20',
        solid: 'bg-accent text-white hover:bg-accent-hover',
        destructive: 'bg-error/15 text-error hover:bg-error/20',
        outline: 'border border-border bg-transparent text-text-secondary hover:bg-elevated hover:text-text-primary',
        secondary: 'bg-elevated text-text-secondary hover:text-text-primary',
        ghost: 'text-text-secondary hover:bg-elevated hover:text-text-primary',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 text-xs',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-9 px-4 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
```

- [ ] **Step 2: Verify buttons render correctly**

Run dev server, check buttons across the app — nav items, dialogs, forms.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/button.tsx
git commit -m "feat(ui): restyle Button with Deep Space variants"
```

---

### Task 7: Restyle Input component

**Files:**
- Modify: `frontend/src/components/ui/input.tsx` (23 lines)

- [ ] **Step 1: Update Input styling**

Replace the className in `input.tsx`:
```typescript
'flex h-8 w-full rounded-md border border-border bg-elevated/50 px-3 py-1 text-sm text-text-primary placeholder:text-text-muted transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'
```

Key changes: remove `focus-visible:ring` classes, add `focus:border-accent`, use `bg-elevated/50`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/input.tsx
git commit -m "feat(ui): restyle Input with Deep Space focus behavior"
```

---

### Task 8: Restyle Card component

**Files:**
- Modify: `frontend/src/components/ui/card.tsx` (54 lines)

- [ ] **Step 1: Update Card styling**

Key changes: remove `shadow-sm`, use `border-border`, ensure `rounded-lg` (8px via --radius):

```typescript
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border border-border bg-surface text-text-primary', className)} {...props} />
  ),
)
```

Remove any `shadow` classes from CardHeader, CardContent, CardFooter as well.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/card.tsx
git commit -m "feat(ui): restyle Card — borders over shadows"
```

---

### Task 9: Restyle Dialog component

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx` (95 lines)

- [ ] **Step 1: Update DialogOverlay**

Change overlay background to `bg-black/60 backdrop-blur-sm`.

- [ ] **Step 2: Update DialogContent**

Remove shadow classes, use border-border, ensure rounded-lg:
```
border border-border bg-surface text-text-primary rounded-lg
```

Remove any `focus:ring` or `focus:outline` classes from DialogContent.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx
git commit -m "feat(ui): restyle Dialog with Deep Space overlay and borders"
```

---

### Task 10: Restyle Select, Badge, Skeleton, Tabs, Checkbox

**Files:**
- Modify: `frontend/src/components/ui/select.tsx` (147 lines)
- Modify: `frontend/src/components/ui/badge.tsx` (25 lines)
- Modify: `frontend/src/components/ui/skeleton.tsx` (15 lines)
- Modify: `frontend/src/components/ui/tabs.tsx` (49 lines)
- Modify: `frontend/src/components/ui/checkbox.tsx` (25 lines)

- [ ] **Step 1: Restyle Select**

SelectTrigger: same as Input — `bg-elevated/50 border-border rounded-md focus:border-accent`, remove ring classes.
SelectContent: `bg-surface border-border rounded-md`, remove shadow.
SelectItem: `focus:bg-elevated focus:text-text-primary`.

- [ ] **Step 2: Restyle Badge**

Remove shadow, use `rounded-md` (6px), default variant: `bg-elevated text-text-secondary border border-border`.

- [ ] **Step 3: Restyle Skeleton**

Update shimmer gradient colors to use `--elevated` and `--surface` tokens. No other changes needed — the animation pattern stays.

- [ ] **Step 4: Restyle Tabs**

TabsList: `bg-transparent` (remove background).
TabsTrigger active: `bg-[hsl(var(--accent-muted))] text-accent font-semibold`. Inactive: `text-text-muted hover:text-text-secondary`. Remove underline indicators.

- [ ] **Step 5: Restyle Checkbox**

Border: `border-border`. Checked: `bg-accent border-accent text-white`. Focus: `border-accent`, no ring.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/select.tsx frontend/src/components/ui/badge.tsx frontend/src/components/ui/skeleton.tsx frontend/src/components/ui/tabs.tsx frontend/src/components/ui/checkbox.tsx
git commit -m "feat(ui): restyle Select, Badge, Skeleton, Tabs, Checkbox"
```

---

### Task 11: Restyle DropdownMenu and Popover

**Files:**
- Modify: `frontend/src/components/ui/dropdown-menu.tsx` (185 lines)
- Modify: `frontend/src/components/ui/popover.tsx` (28 lines)

- [ ] **Step 1: Restyle DropdownMenu**

DropdownMenuContent: `bg-surface border-border rounded-md`, remove shadow.
DropdownMenuItem: `focus:bg-elevated focus:text-text-primary`.
DropdownMenuSeparator: `bg-border`.

- [ ] **Step 2: Restyle Popover**

PopoverContent: `bg-surface border-border rounded-lg`, remove shadow.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/dropdown-menu.tsx frontend/src/components/ui/popover.tsx
git commit -m "feat(ui): restyle DropdownMenu and Popover"
```

---

## Chunk 3: Layout Restructure (Phase 3)

### Task 12a: Build ContextStrip shell

**Files:**
- Create: `frontend/src/components/layout/ContextStrip.tsx`

- [ ] **Step 1: Create ContextStrip layout shell**

Create the 36px flex container with three sections (left/center/right), background `bg-[#0d0d11] dark:bg-[#0d0d11]` (or a custom token), thin bottom border. No data yet — just the structure with placeholder text.

```tsx
export function ContextStrip() {
  return (
    <div className="flex items-center h-9 bg-background/80 border-b border-border px-4 gap-4 flex-shrink-0">
      {/* Left: org switcher */}
      <div className="flex items-center gap-2 pr-4 border-r border-border">
        <span className="text-xs font-medium text-text-secondary">Org placeholder</span>
      </div>
      {/* Center: status indicators */}
      <div className="flex items-center gap-4 flex-1">
        <span className="text-xs text-text-muted">Status loading...</span>
      </div>
      {/* Right: user controls */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-muted">⌘K</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/layout/ContextStrip.tsx
git commit -m "feat(ui): add ContextStrip layout shell"
```

---

### Task 12b: ContextStrip — org switcher (left section)

**Files:**
- Modify: `frontend/src/components/layout/ContextStrip.tsx`

- [ ] **Step 1: Add org switcher**

Import `useUIStore` and tenant data. Render: colored initial icon (8px square, rounded, gradient background), tenant name, dropdown chevron. For single-org users, hide the chevron. Wire up the existing tenant selector logic from Header.tsx.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/layout/ContextStrip.tsx
git commit -m "feat(ui): add org switcher to ContextStrip"
```

---

### Task 12c: ContextStrip — status indicators (center section)

**Files:**
- Modify: `frontend/src/components/layout/ContextStrip.tsx`

- [ ] **Step 1: Add live status indicators**

Use the same `useQuery` key as the fleet dashboard to subscribe to fleet summary data. Render four indicators:
- Offline count: red dot (with `shadow-[0_0_6px_rgba(239,68,68,0.4)]`) + "N down" in red text. Clickable — navigates to devices filtered by offline.
- Degraded count: amber dot + glow + "N degraded". Clickable.
- WiFi status: "WiFi OK" in green or "WiFi N issues" in amber. Clickable — navigates to wireless page.
- Bandwidth: "BW" label in text-muted + value in `font-mono text-text-primary`. Clickable — navigates to traffic page.

Each uses `useNavigate` from React Router. All text is 11px, font-medium.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/layout/ContextStrip.tsx
git commit -m "feat(ui): add live status indicators to ContextStrip"
```

---

### Task 12d: ContextStrip — right section (palette, status, avatar)

**Files:**
- Modify: `frontend/src/components/layout/ContextStrip.tsx`

- [ ] **Step 1: Add right section**

- Command palette shortcut: `text-xs text-text-muted` showing "⌘K". Wire to existing `useCommandPalette` or keyboard shortcut handler.
- Connection status dot: 6px circle, green when connected, amber when reconnecting. Reuse logic from `Header.tsx` `ConnectionIndicator`.
- User avatar: 22px circle, `bg-elevated border border-border`, initials inside. Wrap with the existing DropdownMenu for logout/settings.

- [ ] **Step 2: Verify ContextStrip renders with live data**

Temporarily render ContextStrip above the current layout to test. Check org switcher, status counts, and avatar all work.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/ContextStrip.tsx
git commit -m "feat(ui): complete ContextStrip with user controls"
```

---

### Task 13: Rebuild Sidebar

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx` (385 lines)

- [ ] **Step 1: Replace navigation sections**

Replace the current nav sections (Fleet / Manage / Monitor / Admin) with the new structure:

**Fleet:** Overview, Devices, Wireless, Traffic
**Config:** Editor, Templates, Firmware
**Admin:** Users, Audit Log, Settings

Update the Lucide icons for each item. Section labels use the micro-label style: `text-[10px] uppercase tracking-wider font-semibold text-text-muted`.

Active nav item: `bg-[hsl(var(--accent-muted))] text-accent rounded-md`.
Inactive: `text-text-muted hover:text-text-primary hover:bg-elevated/50 rounded-md`.

- [ ] **Step 2: Update dimensions and collapsed state**

Set the sidebar root element to `w-[180px]` expanded, `w-14` (56px) collapsed. Add `data-sidebar` attribute to the root `<nav>` element so the CSS transition rule from Task 5 applies (200ms ease width transition).

Collapsed: icon-only with tooltips on hover. Version identifier at bottom: `TOD v9.5` in `font-mono text-[9px] text-text-muted`.

- [ ] **Step 3: Remove alert badges from sidebar**

Alerts now surface through ContextStrip, not sidebar badges. Remove AlertBadge imports and rendering.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): rebuild Sidebar with Fleet/Config/Admin structure"
```

---

### Task 14: Replace AppLayout shell

**Files:**
- Modify: `frontend/src/components/layout/AppLayout.tsx` (31 lines)
- Modify: `frontend/src/components/layout/Header.tsx` (225 lines)

- [ ] **Step 1: Update AppLayout**

Replace the layout structure:
```tsx
<div className="flex h-screen overflow-hidden bg-background">
  <Sidebar />
  <div className="flex flex-col flex-1 overflow-hidden">
    <ContextStrip />
    <main id="main-content" className="flex-1 overflow-auto p-5">
      <Outlet />
    </main>
  </div>
  <CommandPalette />
  <Toaster />
</div>
```

Import ContextStrip, remove Header import.

- [ ] **Step 2: Deprecate Header.tsx**

The Header component's responsibilities are now split:
- Connection status → ContextStrip (right section)
- Theme toggle → ContextStrip or Settings page
- User menu → ContextStrip (right section, avatar dropdown)
- Tenant selector → ContextStrip (left section)

Don't delete Header.tsx yet — rename it to `Header.tsx.bak` or add a deprecation comment. We may need to reference it during the transition.

- [ ] **Step 3: Verify the new shell renders**

Run dev server. The app should show: ContextStrip at top, Sidebar on left, main content in remaining space. Navigation should work.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/AppLayout.tsx frontend/src/components/layout/ContextStrip.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/Header.tsx
git commit -m "feat(ui): replace AppLayout with ContextStrip + rebuilt Sidebar"
```

---

### Task 15: Update route paths for new nav

**Files:**
- Modify: `frontend/src/routes/_authenticated/` (various route files)

- [ ] **Step 1: Map current routes to new nav structure**

Current routes → new sidebar mapping:
- Dashboard (`index.tsx`) → Fleet > Overview
- Devices (`tenants/$tenantId/devices/index.tsx`) → Fleet > Devices
- Alerts (`alerts.tsx`) → remove from nav (surfaced via ContextStrip + device detail)
- Config Editor (`config-editor.tsx`) → Config > Editor
- Templates (`templates.tsx`) → Config > Templates
- Firmware (`firmware.tsx`) → Config > Firmware
- Audit (`audit.tsx`) → Admin > Audit Log
- Settings (`settings.tsx`) → Admin > Settings

**Routes that don't exist yet:**
- Fleet > Wireless — no dedicated wireless page exists. For now, link to the dashboard or create a placeholder route (`_authenticated/wireless.tsx`) that shows wireless stats from the fleet summary.
- Fleet > Traffic — no dedicated traffic page exists. Same approach — create a placeholder route (`_authenticated/traffic.tsx`) or link to the dashboard bandwidth section.

These are placeholder pages (a heading + "coming soon" or a subset of dashboard widgets). Full implementations are outside this redesign scope.

Update the Sidebar nav item `to` props to match existing and new route paths.

- [ ] **Step 2: Verify all nav links work**

Click through every sidebar item and confirm it routes correctly.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): wire sidebar nav items to existing routes"
```

---

## Chunk 4: Page-Level Polish (Phase 4)

### Task 16: Polish Fleet Overview (Dashboard)

**Files:**
- Modify: `frontend/src/components/fleet/FleetDashboard.tsx`
- Modify: KPI card components used by the dashboard

- [ ] **Step 1: Update KPI cards**

Apply the gradient background to KPI cards. Use mode-aware classes:
```
bg-gradient-to-br from-[#f8f8ff] to-elevated dark:from-elevated dark:to-[#16162a]
```
Light mode gets a subtle cool-white to elevated gradient. Dark mode gets the Deep Space elevated gradient.

KPI label: `text-[10px] font-medium text-text-muted`
KPI value: `text-2xl font-medium font-mono text-text-primary` (with `tabular-nums`)

- [ ] **Step 2: Update dashboard grid**

Ensure widget cards use `border-border bg-surface rounded-lg` without shadows.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/fleet/
git commit -m "feat(ui): polish Fleet Overview with Deep Space styling"
```

---

### Task 17: Polish device table

**Files:**
- Modify: Device table/list components in `frontend/src/components/fleet/` or route files

- [ ] **Step 1: Update table styling**

- Column headers: `text-[10px] uppercase tracking-wider font-semibold text-text-muted`
- Row borders: `border-b border-border` (subtle)
- No alternating row colors
- Status dots: 5px, border-radius 50%, inline with device name. Apply glow: `shadow-[0_0_6px_rgba(var(--status-color),0.3)]` where status-color matches online/degraded/offline.
- Data columns (IP, CPU, uptime): `font-mono text-text-secondary` (tabular-nums applied globally via Task 5)
- Device name: `font-medium text-text-primary`
- Model/metadata: `text-text-muted`

- [ ] **Step 2: Update filter tabs**

Active tab: `bg-[hsl(var(--accent-muted))] text-accent font-semibold rounded-md`
Inactive: `text-text-muted`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/fleet/ frontend/src/routes/_authenticated/
git commit -m "feat(ui): polish device table with Deep Space styling"
```

---

### Task 18: Polish Config Editor

**Files:**
- Modify: `frontend/src/components/config-editor/ConfigEditorPage.tsx`
- Modify: `frontend/src/components/config-editor/MenuTree.tsx`
- Modify: `frontend/src/components/config-editor/EntryTable.tsx`
- Modify: `frontend/src/components/config-editor/EntryForm.tsx`
- Modify: `frontend/src/components/config-editor/CommandExecutor.tsx`

- [ ] **Step 1: Update MenuTree sidebar**

Section label: micro-label style. Active path: accent ghost-fill. Tree icons: `text-text-muted`. Custom path input: Deep Space input styling.

- [ ] **Step 2: Update EntryTable**

Apply the same table styling from Task 17: micro-label headers, subtle borders, monospace data.

- [ ] **Step 3: Update EntryForm dialog**

Dialog uses restyled Dialog component (Task 9). Inputs use restyled Input (Task 7). Checkboxes use restyled Checkbox (Task 10).

- [ ] **Step 4: Update CommandExecutor**

Command input: monospace, elevated background. Result area: `bg-surface border-border rounded-md font-mono text-xs`. Success/error indicators use status colors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/config-editor/
git commit -m "feat(ui): polish Config Editor with Deep Space styling"
```

---

### Task 19: WCAG contrast audit

**Files:**
- No file changes expected (unless issues found)

- [ ] **Step 1: Audit dark mode contrast**

Check every text/background combination:
- text-primary (`#e4e4ed`) on background (`#111113`): should be ~13:1
- text-secondary (`#8a8aa0`) on background: should be ~4.6:1
- text-muted (`#62627f`) on background: should be ~3.2:1 (OK for UI elements, not body text)
- accent (`#818cf8`) on background: should be ~5.5:1
- accent on surface (`#141420`): should be ~5:1
- status colors on background: all should be ≥3:1

- [ ] **Step 2: Audit light mode contrast**

- text-primary (`#111113`) on background (`#fafafe`): should be ~18:1
- text-secondary (`#52526b`) on background: should be ~6:1
- text-muted (`#8585a0`) on background: should be ~3.5:1
- accent (`#5558e6`) on background: should be ~4.4:1
- accent on surface (`#ffffff`): should be ~4.6:1

- [ ] **Step 3: Fix any failures**

If any combination fails its target ratio, adjust the token value and update `index.css`.

- [ ] **Step 4: Commit (if changes needed)**

```bash
git add frontend/src/index.css
git commit -m "fix(ui): adjust color tokens for WCAG AA compliance"
```

---

### Task 20: Responsive spot-check

**Files:**
- Possibly modify: `frontend/src/components/layout/ContextStrip.tsx`
- Possibly modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Test at tablet width (768px)**

Resize browser to 768px. Verify:
- Sidebar collapses to drawer (existing mobile behavior should still work)
- KPI cards reflow to 2-column (`sm:grid-cols-2` should already handle this)
- ContextStrip content doesn't overflow

- [ ] **Step 2: Test at phone width (375px)**

Resize to 375px. Verify:
- Sidebar is hidden (hamburger menu)
- ContextStrip collapses — if it overflows, add responsive hiding: hide WiFi and BW indicators on `sm:` breakpoint, show only alert count badge
- Device table remains usable (existing responsive behavior)
- All touch targets are at least 44px height

- [ ] **Step 3: Fix any overflow issues**

Common fix for ContextStrip: wrap center indicators in a `hidden sm:flex` container so only the critical "N down" indicator shows on mobile. Full indicators show on `sm:` and above.

- [ ] **Step 4: Commit (if changes needed)**

```bash
git add frontend/src/components/layout/
git commit -m "fix(ui): responsive adjustments for ContextStrip and layout"
```

---

### Task 21: Remove old Geist font files

**Files:**
- Delete: `frontend/src/assets/fonts/Geist-Variable.woff2`
- Delete: `frontend/src/assets/fonts/GeistMono-Variable.woff2`
- Modify: `frontend/package.json` (remove `geist` dependency)

- [ ] **Step 1: Remove Geist font files and package**

```bash
cd frontend
rm src/assets/fonts/Geist-Variable.woff2 src/assets/fonts/GeistMono-Variable.woff2
npm uninstall geist
```

- [ ] **Step 2: Verify nothing references Geist**

```bash
grep -r "Geist" src/ --include="*.ts" --include="*.tsx" --include="*.css"
```

Should return no results.

- [ ] **Step 3: Commit**

```bash
git add -A frontend/src/assets/fonts/ frontend/package.json frontend/package-lock.json
git commit -m "chore: remove Geist font files and dependency"
```

---

### Task 22: Delete deprecated Header component

**Files:**
- Delete or clean up: `frontend/src/components/layout/Header.tsx`

- [ ] **Step 1: Verify Header is not imported anywhere**

```bash
grep -r "Header" frontend/src/ --include="*.ts" --include="*.tsx" | grep -v "DialogHeader\|CardHeader\|mockup-header\|TableHeader"
```

Should only show the backup file or no results.

- [ ] **Step 2: Delete Header.tsx**

```bash
rm frontend/src/components/layout/Header.tsx
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Header.tsx
git commit -m "chore: remove deprecated Header component (replaced by ContextStrip)"
```
