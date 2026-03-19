/**
 * Returns a Tailwind text color class based on wireless signal strength.
 *
 * Thresholds:
 *   >= -65 dBm  -> green (good)
 *   >= -75 dBm  -> yellow (marginal)
 *   <  -75 dBm  -> red (poor)
 */
export function signalColor(dbm: number | null): string {
  if (dbm == null) return 'text-text-muted'
  if (dbm >= -65) return 'text-success'
  if (dbm >= -75) return 'text-warning'
  return 'text-error'
}
