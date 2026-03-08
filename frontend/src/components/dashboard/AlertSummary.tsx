import { Link } from '@tanstack/react-router'
import { PieChart, Pie, Cell } from 'recharts'
import { CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'

export interface AlertSummaryProps {
  criticalCount: number
  warningCount: number
  infoCount: number
  tenantId: string
}

const SEVERITY_CONFIG = [
  {
    key: 'critical' as const,
    label: 'Critical',
    color: 'hsl(var(--chart-4))',
    badgeClass: 'bg-error/10 text-error hover:bg-error/20',
  },
  {
    key: 'warning' as const,
    label: 'Warning',
    color: 'hsl(var(--chart-3))',
    badgeClass: 'bg-warning/10 text-warning hover:bg-warning/20',
  },
  {
    key: 'info' as const,
    label: 'Info',
    color: 'hsl(var(--chart-1))',
    badgeClass: 'bg-accent/10 text-accent hover:bg-accent/20',
  },
]

function CenterLabel({ total }: { total: number }) {
  const animated = useAnimatedCounter(total, 600, 0)
  return (
    <text
      x={80}
      y={80}
      textAnchor="middle"
      dominantBaseline="central"
      className="fill-text-primary text-lg font-bold font-mono"
    >
      {animated}
    </text>
  )
}

export function AlertSummary({
  criticalCount,
  warningCount,
  infoCount,
  tenantId,
}: AlertSummaryProps) {
  const total = criticalCount + warningCount + infoCount
  const counts: Record<string, number> = {
    critical: criticalCount,
    warning: warningCount,
    info: infoCount,
  }

  // Build pie data, filtering out zero-value segments
  const pieData = SEVERITY_CONFIG.filter((s) => counts[s.key] > 0).map((s) => ({
    name: s.label,
    value: counts[s.key],
    color: s.color,
  }))

  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-text-secondary">
          Alert Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <CheckCircle className="h-10 w-10 text-success" />
            <span className="text-sm font-medium text-success">All Clear</span>
            <span className="text-xs text-text-muted">No active alerts</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {/* Donut chart with center total */}
            <div style={{ width: 160, height: 160 }}>
              <PieChart width={160} height={160}>
                <Pie
                  data={pieData}
                  cx={75}
                  cy={75}
                  innerRadius={40}
                  outerRadius={60}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <CenterLabel total={total} />
              </PieChart>
            </div>

            {/* Severity badges */}
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {SEVERITY_CONFIG.map((s) => (
                <Link
                  key={s.key}
                  to="/alerts"
                  search={{ severity: s.key }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${s.badgeClass}`}
                >
                  <span className="tabular-nums font-mono">{counts[s.key]}</span>
                  {s.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
