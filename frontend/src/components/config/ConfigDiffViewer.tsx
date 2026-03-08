import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DiffView, DiffModeEnum, DiffFile } from '@git-diff-view/react'
import { highlighter } from '@git-diff-view/lowlight'
import '@git-diff-view/react/styles/diff-view.css'
import { Lock } from 'lucide-react'
import { configApi } from '@/lib/api'

interface ConfigDiffViewerProps {
  tenantId: string
  deviceId: string
  oldSha: string
  newSha: string
  oldDate: string
  newDate: string
  /** Whether either backup being compared is encrypted */
  isEncrypted?: boolean
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

/**
 * Config diff viewer with client-side diff computation.
 *
 * For encrypted backups (Tier 2), the server decrypts Transit ciphertext
 * and returns plaintext. The diff is computed entirely in the browser
 * by @git-diff-view/react (client-side DiffFile instance).
 *
 * For future Tier 1 (client-side encrypted) backups, the decryptForDiff
 * utility from @/lib/diffUtils will decrypt with the vault key before
 * passing text to the diff viewer.
 */
export function ConfigDiffViewer({
  tenantId,
  deviceId,
  oldSha,
  newSha,
  oldDate,
  newDate,
  isEncrypted = false,
}: ConfigDiffViewerProps) {
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Split)

  const { data: oldText, isLoading: loadingOld } = useQuery({
    queryKey: ['config-export', tenantId, deviceId, oldSha],
    queryFn: () => configApi.getExportText(tenantId, deviceId, oldSha),
  })

  const { data: newText, isLoading: loadingNew } = useQuery({
    queryKey: ['config-export', tenantId, deviceId, newSha],
    queryFn: () => configApi.getExportText(tenantId, deviceId, newSha),
  })

  const diffFile = useMemo(() => {
    if (!oldText || !newText) return null

    const file = DiffFile.createInstance({
      oldFile: {
        fileName: 'export.rsc',
        fileLang: 'routeros',
        content: oldText,
      },
      newFile: {
        fileName: 'export.rsc',
        fileLang: 'routeros',
        content: newText,
      },
      hunks: [],
    })

    file.initTheme('dark')
    file.init()
    file.buildSplitDiffLines()
    file.buildUnifiedDiffLines()

    return file
  }, [oldText, newText])

  const isLoading = loadingOld || loadingNew

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          {isEncrypted && (
            <span className="inline-flex items-center gap-1 text-info" title="Decrypted from encrypted backup">
              <Lock className="h-3 w-3" />
            </span>
          )}
          <span className="font-mono text-text-muted">{oldSha.slice(0, 7)}</span>
          {' '}
          <span className="text-text-muted">{formatDate(oldDate)}</span>
          {' '}
          <span className="text-text-muted mx-1">&rarr;</span>
          {' '}
          <span className="font-mono text-text-muted">{newSha.slice(0, 7)}</span>
          {' '}
          <span className="text-text-muted">{formatDate(newDate)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode(DiffModeEnum.Split)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              mode === DiffModeEnum.Split
                ? 'bg-border text-text-primary'
                : 'text-text-muted hover:text-text-primary/70'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setMode(DiffModeEnum.Unified)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              mode === DiffModeEnum.Unified
                ? 'bg-border text-text-primary'
                : 'text-text-muted hover:text-text-primary/70'
            }`}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Diff content */}
      {isLoading ? (
        <div className="p-8 text-center text-sm text-text-muted animate-pulse">
          Loading diff...
        </div>
      ) : !diffFile ? (
        <div className="p-8 text-center text-sm text-text-muted">
          Unable to load backup contents.
        </div>
      ) : (
        <div className="diff-view-wrapper overflow-auto max-h-[600px]">
          <DiffView
            diffFile={diffFile}
            diffViewMode={mode}
            diffViewTheme="dark"
            diffViewHighlight
            registerHighlighter={highlighter}
          />
        </div>
      )}
    </div>
  )
}
