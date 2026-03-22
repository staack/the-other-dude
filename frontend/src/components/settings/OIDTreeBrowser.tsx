import { useState, useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OIDNode } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────────────────────

interface OIDTreeBrowserProps {
  nodes: OIDNode[]
  selectedOids: Set<string>
  onToggleOid: (oid: string, node: OIDNode) => void
}

interface FlatOIDRow {
  node: OIDNode
  depth: number
  hasChildren: boolean
  isExpanded: boolean
}

// ─── Tree Flattening ────────────────────────────────────────────────────────

function flattenTree(
  nodes: OIDNode[],
  expandedOids: Set<string>,
  depth: number = 0,
): FlatOIDRow[] {
  const result: FlatOIDRow[] = []
  for (const node of nodes) {
    const hasChildren = (node.children?.length ?? 0) > 0
    const isExpanded = expandedOids.has(node.oid)
    result.push({ node, depth, hasChildren, isExpanded })
    if (hasChildren && isExpanded && node.children) {
      result.push(...flattenTree(node.children, expandedOids, depth + 1))
    }
  }
  return result
}

function countAllNodes(nodes: OIDNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += 1
    if (node.children) count += countAllNodes(node.children)
  }
  return count
}

function collectAllOids(nodes: OIDNode[], set: Set<string>): void {
  for (const node of nodes) {
    set.add(node.oid)
    if (node.children) collectAllOids(node.children, set)
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function OIDTreeBrowser({ nodes, selectedOids, onToggleOid }: OIDTreeBrowserProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedOids, setExpandedOids] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const totalNodeCount = useMemo(() => countAllNodes(nodes), [nodes])

  const flatRows = useMemo(
    () => flattenTree(nodes, expandedOids),
    [nodes, expandedOids],
  )

  // Filter rows when search is active
  const filteredRows = useMemo(() => {
    if (!search.trim()) return flatRows
    const term = search.toLowerCase()
    return flatRows.filter(
      (row) =>
        row.node.name.toLowerCase().includes(term) ||
        row.node.oid.toLowerCase().includes(term),
    )
  }, [flatRows, search])

  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 10,
  })

  const toggleExpand = useCallback((oid: string) => {
    setExpandedOids((prev) => {
      const next = new Set(prev)
      if (next.has(oid)) {
        next.delete(oid)
      } else {
        next.add(oid)
      }
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    const allOids = new Set<string>()
    collectAllOids(nodes, allOids)
    setExpandedOids(allOids)
  }, [nodes])

  const collapseAll = useCallback(() => {
    setExpandedOids(new Set())
  }, [])

  // ─── Empty state ──────────────────────────────────────────────────────

  if (nodes.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-text-muted">Upload a MIB file to browse OIDs</p>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or OID..."
            className="h-7 text-xs pl-7"
          />
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={expandAll}>
          <ChevronsUpDown className="h-3.5 w-3.5" /> Expand
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={collapseAll}>
          <ChevronsDownUp className="h-3.5 w-3.5" /> Collapse
        </Button>
        <span className="text-[10px] text-text-muted whitespace-nowrap">
          {filteredRows.length} of {totalNodeCount} nodes
        </span>
      </div>

      {/* Tree */}
      <div
        ref={scrollRef}
        role="tree"
        className="h-[400px] overflow-auto border border-border rounded-sm"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = filteredRows[virtualRow.index]
            const isSelectable = !row.hasChildren || !!row.node.type
            const isSelected = selectedOids.has(row.node.oid)

            return (
              <div
                key={row.node.oid}
                role="treeitem"
                aria-expanded={row.hasChildren ? row.isExpanded : undefined}
                aria-level={row.depth + 1}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={`flex items-center gap-2 h-8 hover:bg-surface-hover cursor-pointer ${isSelected ? 'bg-accent/10' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: `${row.depth * 20 + 8}px`,
                }}
              >
                {/* Expand/collapse chevron */}
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="flex-shrink-0 p-0.5 hover:bg-surface-raised rounded"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(row.node.oid)
                    }}
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 text-text-muted transition-transform ${row.isExpanded ? 'rotate-90' : ''}`}
                    />
                  </button>
                ) : (
                  <span className="w-5 flex-shrink-0" />
                )}

                {/* Checkbox for selectable nodes */}
                {isSelectable && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleOid(row.node.oid, row.node)}
                    className="flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                {/* Name */}
                <span
                  className="text-sm text-text-primary font-mono truncate"
                  title={row.node.description ?? undefined}
                >
                  {row.node.name}
                </span>

                {/* OID */}
                <span className="text-xs text-text-muted font-mono flex-shrink-0">
                  {row.node.oid}
                </span>

                {/* Type badge */}
                {row.node.type && (
                  <span className="text-[10px] bg-surface-raised px-1 py-0.5 rounded flex-shrink-0">
                    {row.node.type}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
