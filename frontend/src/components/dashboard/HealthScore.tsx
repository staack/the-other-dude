import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'

export interface HealthScoreProps {
  devices: Array<{
    status: string
    last_cpu_load: number | null
    last_memory_used_pct: number | null
  }>
  activeAlerts: number
  criticalAlerts: number
}

interface ScoreTier {
  label: string
  colorClass: string
  strokeColor: string
}

function getScoreTier(score: number): ScoreTier {
  if (score > 80)
    return {
      label: 'Excellent',
      colorClass: 'text-success',
      strokeColor: 'hsl(var(--success))',
    }
  if (score >= 60)
    return {
      label: 'Good',
      colorClass: 'text-warning',
      strokeColor: 'hsl(var(--warning))',
    }
  if (score >= 40)
    return {
      label: 'Fair',
      colorClass: 'text-warning',
      strokeColor: 'hsl(var(--warning))',
    }
  if (score === 0)
    return {
      label: 'Critical',
      colorClass: 'text-error',
      strokeColor: 'hsl(var(--error))',
    }
  return {
    label: 'Poor',
    colorClass: 'text-error',
    strokeColor: 'hsl(var(--error))',
  }
}

/**
 * Computes a weighted composite health score from device metrics.
 *
 * Components:
 * - Device online % (weight 0.4)
 * - CPU healthy % (weight 0.2) -- % of online devices with CPU < 80%
 * - Memory healthy % (weight 0.2) -- % of online devices with memory < 80%
 * - Critical alert penalty (weight 0.2) -- 100 if 0 critical, 50 if 1-2, 0 if 3+
 */
// eslint-disable-next-line react-refresh/only-export-components
export function computeHealthScore(
  devices: HealthScoreProps['devices'],
  criticalAlerts: number,
): number {
  if (devices.length === 0) return 0

  const total = devices.length
  const onlineDevices = devices.filter((d) => d.status === 'online')
  const onlineCount = onlineDevices.length

  // If no devices are online, health is 0 — don't inflate with default sub-scores
  if (onlineCount === 0) return 0

  // Component 1: Device online percentage
  const onlinePct = (onlineCount / total) * 100

  // Component 2: CPU healthy percentage (of online devices with CPU data)
  let cpuHealthy = 100
  const withCpu = onlineDevices.filter((d) => d.last_cpu_load !== null)
  if (withCpu.length > 0) {
    const healthyCpu = withCpu.filter((d) => d.last_cpu_load! < 80).length
    cpuHealthy = (healthyCpu / withCpu.length) * 100
  }

  // Component 3: Memory healthy percentage (of online devices with memory data)
  let memHealthy = 100
  const withMem = onlineDevices.filter(
    (d) => d.last_memory_used_pct !== null,
  )
  if (withMem.length > 0) {
    const healthyMem = withMem.filter(
      (d) => d.last_memory_used_pct! < 80,
    ).length
    memHealthy = (healthyMem / withMem.length) * 100
  }

  // Component 4: Critical alert penalty
  let alertScore = 100
  if (criticalAlerts >= 3) alertScore = 0
  else if (criticalAlerts >= 1) alertScore = 50

  // Weighted composite
  const score =
    onlinePct * 0.4 + cpuHealthy * 0.2 + memHealthy * 0.2 + alertScore * 0.2

  return Math.min(100, Math.max(0, Math.round(score)))
}

// SVG gauge constants
const RADIUS = 60
const STROKE_WIDTH = 8
const VIEWBOX_SIZE = (RADIUS + STROKE_WIDTH) * 2
const CENTER = VIEWBOX_SIZE / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function HealthScore({
  devices,
  criticalAlerts,
}: HealthScoreProps) {
  const totalDevices = devices.length
  const isEmpty = totalDevices === 0
  const score = computeHealthScore(devices, criticalAlerts)
  const animatedScore = useAnimatedCounter(score, 800, 0)
  const tier = isEmpty
    ? { label: 'N/A', colorClass: 'text-text-secondary', strokeColor: 'hsl(var(--border))' }
    : getScoreTier(score)

  // Calculate stroke-dashoffset for the ring
  // Progress goes from 0 (empty) to CIRCUMFERENCE (full)
  const progress = isEmpty ? 0 : animatedScore / 100
  const dashOffset = CIRCUMFERENCE * (1 - progress)

  return (
    <Card className="bg-panel border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-text-secondary">
          Network Health
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center pb-4">
        <div className="relative" style={{ width: VIEWBOX_SIZE, height: VIEWBOX_SIZE }}>
          <svg
            width={VIEWBOX_SIZE}
            height={VIEWBOX_SIZE}
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            className="transform -rotate-90"
          >
            {/* Background ring */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={STROKE_WIDTH}
            />
            {/* Foreground (progress) ring */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={tier.strokeColor}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
          </svg>
          {/* Center text (not rotated) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`text-3xl font-bold font-mono tabular-nums ${tier.colorClass}`}
            >
              {isEmpty ? 'N/A' : animatedScore}
            </span>
            <span className={`text-xs font-medium ${tier.colorClass}`}>
              {tier.label}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
