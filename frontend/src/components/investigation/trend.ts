import type { HealthMetricPoint } from "@/lib/api";
/** Missing buckets stay gaps. Values are plotted against real time, never array position. */
export function trendSegments(
  data: HealthMetricPoint[],
  metric: "avg_cpu" | "avg_mem_pct",
  start: number,
  end: number,
): string[] {
  const points = data
    .filter((p) => Number.isFinite(Date.parse(p.bucket)))
    .sort((a, b) => Date.parse(a.bucket) - Date.parse(b.bucket));
  const intervals = points
    .slice(1)
    .map((p, i) => Date.parse(p.bucket) - Date.parse(points[i].bucket))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const gap = (intervals[Math.floor(intervals.length / 2)] ?? 60000) * 3;
  const segments: string[] = [];
  let current: string[] = [];
  let previous = 0;
  for (const p of points) {
    const t = Date.parse(p.bucket),
      value = p[metric];
    if (
      value == null ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      (previous && t - previous > gap)
    ) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    }
    if (
      value != null &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100 &&
      t >= start &&
      t <= end
    )
      current.push(
        `${(((t - start) / (end - start)) * 1000).toFixed(2)},${(100 - value).toFixed(2)}`,
      );
    previous = t;
  }
  if (current.length) segments.push(current.join(" "));
  return segments;
}
