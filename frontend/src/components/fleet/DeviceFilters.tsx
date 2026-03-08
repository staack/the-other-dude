import { useNavigate, useSearch } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useCallback, useRef, useEffect } from 'react'

interface DeviceFiltersProps {
  tenantId: string
}

const DEBOUNCE_MS = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DeviceFilters({ tenantId }: DeviceFiltersProps) {
  // Use relative navigation for filter params
  const navigate = useNavigate()
  // Safely get search params
  let searchObj: { search?: string; status?: string; page?: number; page_size?: number } = {}
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    searchObj = useSearch({ from: '/_authenticated/tenants/$tenantId/devices/' }) as typeof searchObj
  } catch {
    searchObj = {}
  }

  const searchText = searchObj.search ?? ''
  const statusFilter = searchObj.status ?? ''

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync input value with URL param
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== searchText) {
      inputRef.current.value = searchText
    }
  }, [searchText])

  const updateFilter = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      void navigate({
        to: '/tenants/$tenantId/devices',
        params: { tenantId },
        search: (prev) => ({ ...prev, ...updates, page: 1 }),
      })
    },
    [navigate, tenantId],
  )

  const handleSearch = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateFilter({ search: value || undefined })
    }, DEBOUNCE_MS)
  }

  const handleStatus = (value: string) => {
    updateFilter({ status: value === 'all' ? undefined : value })
  }

  const hasFilters = !!(searchText || statusFilter)

  const clearFilters = () => {
    if (inputRef.current) inputRef.current.value = ''
    updateFilter({ search: undefined, status: undefined })
  }

  return (
    <div className="flex items-center gap-2">
      {/* Text search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
        <Input
          ref={inputRef}
          className="pl-8"
          placeholder="Search hostname, IP..."
          defaultValue={searchText}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {/* Status filter */}
      <Select value={statusFilter || 'all'} onValueChange={handleStatus}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder="All status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All status</SelectItem>
          <SelectItem value="online">Online</SelectItem>
          <SelectItem value="offline">Offline</SelectItem>
          <SelectItem value="unknown">Not Yet Polled</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-text-muted">
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  )
}
