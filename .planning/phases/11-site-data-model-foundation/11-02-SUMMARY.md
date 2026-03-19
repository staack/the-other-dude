---
phase: 11-site-data-model-foundation
plan: 02
subsystem: ui, frontend
tags: [react, tanstack-router, tanstack-query, tailwind, lucide]

# Dependency graph
requires:
  - phase: 11-site-data-model-foundation plan 01
    provides: Sites CRUD REST API with health rollup
provides:
  - Site list page with sortable table, search, and CRUD dialogs
  - Site detail page with health stats summary
  - sitesApi frontend client with CRUD + device assignment methods
  - Sites navigation in sidebar and tenant index
affects: [11-03, 14-site-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SiteTable follows FleetTable pattern (SortHeader, EmptyState, TableSkeleton)"
    - "SiteFormDialog uses useMutation with queryClient.invalidateQueries for cache sync"
    - "Delete confirmation via Dialog component (no separate AlertDialog needed)"

key-files:
  created:
    - frontend/src/lib/api.ts (sitesApi section)
    - frontend/src/components/sites/SiteFormDialog.tsx
    - frontend/src/components/sites/SiteTable.tsx
    - frontend/src/routes/_authenticated/tenants/$tenantId/sites/index.tsx
    - frontend/src/routes/_authenticated/tenants/$tenantId/sites/$siteId.tsx
  modified:
    - frontend/src/components/layout/Sidebar.tsx
    - frontend/src/routes/_authenticated/tenants/$tenantId/index.tsx
    - frontend/src/routeTree.gen.ts

key-decisions:
  - "Used Dialog component for delete confirmation instead of AlertDialog (not present in UI library)"
  - "Textarea rendered as native element with project styling (no Textarea UI component exists)"
  - "Site detail page is intentionally minimal -- full dashboard deferred to Phase 14"

patterns-established:
  - "Sites components in frontend/src/components/sites/ directory"
  - "canWrite(user) gates edit/delete actions in table rows"

requirements-completed: [DASH-01, SITE-01, SITE-02]

# Metrics
duration: 6min
completed: 2026-03-19
---

# Phase 11 Plan 02: Frontend Site List and Detail Pages Summary

**Site list page with sortable table, health rollup columns, CRUD dialogs, delete confirmation, and site detail page with stats cards**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-19T02:41:33Z
- **Completed:** 2026-03-19T02:47:05Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- sitesApi client with all CRUD methods plus assignDevice, removeDevice, and bulkAssign
- Site list page at /tenants/{tenantId}/sites with sortable table, search filter, create/edit dialogs, and delete confirmation
- Site detail page at /tenants/{tenantId}/sites/{siteId} with info card and health stats (devices, online, online %, alerts)
- Sites navigation integrated into sidebar Fleet section and tenant index page with count card

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sitesApi client and SiteFormDialog component** - `3a965e0` (feat)
2. **Task 2: Create SiteTable, site list page, and site detail page** - `40f2bcd` (feat)
3. **Task 3: Add Sites to sidebar navigation and tenant index page** - `e8c69fb` (feat)

## Files Created/Modified
- `frontend/src/lib/api.ts` - Added SiteResponse, SiteListResponse, SiteCreate, SiteUpdate interfaces and sitesApi client
- `frontend/src/components/sites/SiteFormDialog.tsx` - Create/edit site dialog with mutation and cache invalidation
- `frontend/src/components/sites/SiteTable.tsx` - Sortable table with delete confirmation, unassigned row, empty state
- `frontend/src/routes/_authenticated/tenants/$tenantId/sites/index.tsx` - Site list page route
- `frontend/src/routes/_authenticated/tenants/$tenantId/sites/$siteId.tsx` - Site detail page with health stats
- `frontend/src/components/layout/Sidebar.tsx` - Added MapPin icon and Sites nav link
- `frontend/src/routes/_authenticated/tenants/$tenantId/index.tsx` - Added Sites count card and "Manage sites" link
- `frontend/src/routeTree.gen.ts` - Regenerated with new site routes

## Decisions Made
- Used Dialog component for delete confirmation instead of AlertDialog (AlertDialog not present in the project UI library)
- Used native textarea element with project Tailwind styling since no Textarea UI component exists
- Site detail page kept intentionally minimal (info + stats) -- full site dashboard with device list deferred to Phase 14

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Route tree (routeTree.gen.ts) needed regeneration via vite build to register new site routes -- resolved by running `npx vite build`

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Site list and detail pages ready for map integration (Plan 03)
- Site detail page ready for Phase 14 full dashboard expansion (device list, map, sector views)
- Frontend can connect to backend sites API once backend migration 030 is run

## Self-Check: PASSED

All created files verified on disk. All 3 task commits (3a965e0, 40f2bcd, e8c69fb) verified in git log.

---
*Phase: 11-site-data-model-foundation*
*Completed: 2026-03-19*
