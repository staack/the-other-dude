# Operations preview

Operations is an opt-in, read-only review screen at `/operations`. Fleet, device
pages and Alerts remain available. It is disabled in standard builds.

To run locally from `frontend/`:

```sh
VITE_OPERATIONS_PREVIEW=true npm run dev
```

To build an enabled preview:

```sh
VITE_OPERATIONS_PREVIEW=true npm run build
```

For a separately tagged Docker preview image, from the repository root:

```sh
docker build -f infrastructure/docker/Dockerfile.frontend \
  --build-arg VITE_OPERATIONS_PREVIEW=true -t tod-frontend:operations-preview .
```

This is a build flag. Setting a variable on an already-built nginx container does
not enable it. Omit the flag or set it to `false` to restore the standard build.
There is no migration, firmware update or installation change.

## Evidence and limitations

- Uses the existing tenant fleet summary and firing/flapping alert endpoints.
  Super admins must select an organization. Regular users always use their own
  authenticated tenant, regardless of a persisted organization selector.
- Reads device status and last contact from the API, using a separate fleet cache
  because the existing fleet SSE handler can synthesize last-contact timestamps.
- Refreshes every 30 seconds and supports manual refresh. Cached evidence remains
  visible if a later refresh fails, with an incomplete-monitoring message.
- Contact within five minutes is considered recent **for this preview**. This is
  a review threshold, not the configured poll interval or proof of metric freshness.
  Missing, invalid, future or old contact does not establish an outage.
- Reports offline/degraded status and configured alert evidence. Zero clients alone
  never creates an incident. It does not infer uplink capacity, latency, packet loss,
  cause or user impact. No synthetic production charts are included.
- Loads at most 200 firing and 200 flapping alerts. If the response's total exceeds
  the loaded items, the screen explicitly reports incomplete alert coverage and
  links to Alerts. Resolved alerts are not part of the current review queue.
- Shows 30 queue entries initially, with Show more. A selected item restored outside
  that initial window is pinned into the queue. Status and alert entries can refer
  to the same device; the headline counts distinct devices.
- Selection is in the URL `issue` parameter. Browser Back from device detail restores
  the selected investigation. Query caches are scoped by organization and user;
  selection is not stored in a shared browser storage bucket.
- Uses locally served IBM Plex Sans Latin 400/500/600 fonts and scoped slate/blue
  styling with light and dark modes. Other pages retain their existing design.

## Loading behavior

The frontend uses normal lazy-route bundle splitting instead of manually grouped
feature bundles. Configuration, chart and topology libraries are no longer
preloaded by the entry HTML. Route changes render without the previous 200 ms
entry/exit animation. These loading changes also apply when the preview is off.
Large device and settings bundles remain a separate follow-up.

## Validation

Run `npm run build`, `npm test`, and lint the changed frontend files. Backend API
contract tests are in `backend/tests/integration/test_operations_evidence.py` and
require an isolated PostgreSQL/TimescaleDB with the existing integration fixtures.
They verify real tenant RLS, zero-client/last-contact fields, selected-tenant access
for super admins, firing/flapping filtering, pagination totals, and a 1,000-device
response. They do not contact routers.

Before promoting this preview: check real installation polling intervals and
alert volume, test with operators, and measure cold/warm browser loads on agreed
hardware and network conditions. The remaining device/settings bundles are large;
a smaller entry bundle does not make every device tab inexpensive.
