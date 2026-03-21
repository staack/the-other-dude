/**
 * Reports generation page.
 *
 * Allows operators to generate and download device inventory,
 * metrics summary, alert history, and change log reports as PDF or CSV.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  FileText,
  BarChart3,
  AlertTriangle,
  ClipboardList,
  Download,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { reportsApi, type ReportRequest } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ReportsPageProps {
  tenantId: string
}

interface ReportTypeOption {
  type: ReportRequest['type']
  title: string
  description: string
  icon: React.FC<{ className?: string }>
  needsDateRange: boolean
}

const REPORT_TYPES: ReportTypeOption[] = [
  {
    type: 'device_inventory',
    title: 'Device Inventory',
    description: 'Complete list of all devices with status and details',
    icon: FileText,
    needsDateRange: false,
  },
  {
    type: 'metrics_summary',
    title: 'Metrics Summary',
    description: 'CPU, memory, and resource usage aggregated by device',
    icon: BarChart3,
    needsDateRange: true,
  },
  {
    type: 'alert_history',
    title: 'Alert History',
    description: 'All alerts fired and resolved with severity breakdown',
    icon: AlertTriangle,
    needsDateRange: true,
  },
  {
    type: 'change_log',
    title: 'Change Log',
    description: 'Audit trail of configuration and management changes',
    icon: ClipboardList,
    needsDateRange: true,
  },
]

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: thirtyDaysAgo.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

export function ReportsPage({ tenantId }: ReportsPageProps) {
  const defaults = getDefaultDateRange()
  const [selectedType, setSelectedType] = useState<ReportRequest['type']>('device_inventory')
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)

  const selectedOption = REPORT_TYPES.find((r) => r.type === selectedType)

  const generateMutation = useMutation({
    mutationFn: () => {
      const request: ReportRequest = {
        type: selectedType,
        format,
        ...(selectedOption?.needsDateRange && {
          date_from: new Date(dateFrom).toISOString(),
          date_to: new Date(dateTo + 'T23:59:59').toISOString(),
        }),
      }
      return reportsApi.generate(tenantId, request)
    },
    onSuccess: () => {
      toast.success('Report generated', {
        description: `${selectedOption?.title} downloaded as ${format.toUpperCase()}.`,
      })
    },
    onError: (err: Error) => {
      toast.error('Report generation failed', {
        description: err.message || 'Please try again.',
      })
    },
  })

  return (
    <div className="space-y-6">
      {/* Report type selection */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3">
          Select Report Type
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {REPORT_TYPES.map((rt) => {
            const Icon = rt.icon
            const isSelected = selectedType === rt.type
            return (
              <button
                key={rt.type}
                onClick={() => setSelectedType(rt.type)}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-lg border text-left transition-all',
                  isSelected
                    ? 'border-accent bg-accent-soft/30 ring-1 ring-accent'
                    : 'border-border bg-panel hover:border-text-muted',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 rounded-md p-2',
                    isSelected ? 'bg-accent/10 text-accent' : 'bg-elevated text-text-muted',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div
                    className={cn(
                      'text-sm font-medium',
                      isSelected ? 'text-accent' : 'text-text-primary',
                    )}
                  >
                    {rt.title}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {rt.description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Date range (shown for all types except device_inventory) */}
      {selectedOption?.needsDateRange && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            Date Range
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label
                htmlFor="date-from"
                className="block text-xs text-text-muted mb-1"
              >
                From
              </label>
              <input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-panel px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="date-to"
                className="block text-xs text-text-muted mb-1"
              >
                To
              </label>
              <input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-panel px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        </div>
      )}

      {/* Format toggle */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3">
          Output Format
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setFormat('pdf')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              format === 'pdf'
                ? 'bg-accent text-white'
                : 'bg-elevated text-text-secondary hover:text-text-primary',
            )}
          >
            PDF
          </button>
          <button
            onClick={() => setFormat('csv')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              format === 'csv'
                ? 'bg-accent text-white'
                : 'bg-elevated text-text-secondary hover:text-text-primary',
            )}
          >
            CSV
          </button>
        </div>
      </div>

      {/* Generate button */}
      <div className="pt-2">
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || !tenantId}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-medium transition-colors',
            'bg-accent text-white hover:bg-accent/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Generate Report
            </>
          )}
        </button>
      </div>
    </div>
  )
}
