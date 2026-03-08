/**
 * Reusable hooks for config panel browse/apply operations.
 *
 * useConfigBrowse — wraps configEditorApi.browse with TanStack Query caching
 * useConfigPanel  — manages pending changes, apply mode, and execution
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { configEditorApi } from '@/lib/configEditorApi'
import {
  type ApplyMode,
  type ConfigChange,
  DEFAULT_APPLY_MODES,
} from '@/lib/configPanelTypes'

// ---------------------------------------------------------------------------
// useConfigBrowse
// ---------------------------------------------------------------------------

interface UseConfigBrowseOptions {
  /** Only fetch when true (tab active guard) */
  enabled?: boolean
  /** Refetch interval in ms (0 = disabled) */
  refetchInterval?: number
}

/**
 * Wraps configEditorApi.browse with TanStack Query for automatic caching,
 * refetching, and loading/error state management.
 */
export function useConfigBrowse(
  tenantId: string,
  deviceId: string,
  path: string,
  options: UseConfigBrowseOptions = {},
) {
  const { enabled = true, refetchInterval = 0 } = options

  const query = useQuery({
    queryKey: ['config-browse', tenantId, deviceId, path],
    queryFn: () => configEditorApi.browse(tenantId, deviceId, path),
    enabled: enabled && !!tenantId && !!deviceId && !!path,
    refetchInterval: refetchInterval || undefined,
    staleTime: 30_000, // 30s — config doesn't change often
  })

  return {
    entries: query.data?.entries ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// useConfigPanel
// ---------------------------------------------------------------------------

/**
 * Manages the full config apply workflow: pending changes collection,
 * apply mode toggling, and execution via the config editor API.
 */
export function useConfigPanel(
  tenantId: string,
  deviceId: string,
  panelType: string,
) {
  const queryClient = useQueryClient()
  const [pendingChanges, setPendingChanges] = useState<ConfigChange[]>([])
  const [applyMode, setApplyMode] = useState<ApplyMode>(
    DEFAULT_APPLY_MODES[panelType] ?? 'quick',
  )

  const addChange = useCallback((change: ConfigChange) => {
    setPendingChanges((prev) => [...prev, change])
  }, [])

  const removeChange = useCallback((index: number) => {
    setPendingChanges((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearChanges = useCallback(() => {
    setPendingChanges([])
  }, [])

  const applyMutation = useMutation({
    mutationFn: async (changes: ConfigChange[]) => {
      // Both modes execute changes sequentially via the binary API.
      // "Safe" mode defaults are set per-panel to trigger the review/confirm
      // dialog before execution — the safety is in the UI review step.
      for (const change of changes) {
        let result
        switch (change.operation) {
          case 'add':
            result = await configEditorApi.addEntry(
              tenantId,
              deviceId,
              change.path,
              change.properties,
            )
            break
          case 'set':
            result = await configEditorApi.setEntry(
              tenantId,
              deviceId,
              change.path,
              change.entryId,
              change.properties,
            )
            break
          case 'remove':
            if (!change.entryId) {
              throw new Error(`Remove operation requires entryId: ${change.description}`)
            }
            result = await configEditorApi.removeEntry(
              tenantId,
              deviceId,
              change.path,
              change.entryId,
            )
            break
        }
        if (!result.success) {
          throw new Error(result.error ?? `Failed: ${change.description}`)
        }
      }
    },
    onSuccess: () => {
      const count = pendingChanges.length
      setPendingChanges([])
      toast.success(`${count} change${count !== 1 ? 's' : ''} applied successfully`)
      // Invalidate all config-browse queries for this device to refresh data
      queryClient.invalidateQueries({
        queryKey: ['config-browse', tenantId, deviceId],
      })
    },
    onError: (error: Error) => {
      toast.error('Configuration failed', {
        description: error.message,
      })
    },
  })

  const applyChanges = useCallback(() => {
    if (pendingChanges.length === 0) return
    applyMutation.mutate(pendingChanges)
  }, [pendingChanges, applyMutation])

  return {
    pendingChanges,
    applyMode,
    setApplyMode,
    addChange,
    removeChange,
    clearChanges,
    applyChanges,
    isApplying: applyMutation.isPending,
  }
}
