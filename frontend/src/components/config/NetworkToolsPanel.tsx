/**
 * NetworkToolsPanel -- Container for network diagnostic tools.
 *
 * Sub-tabs: Ping, Traceroute, Bandwidth Test, Torch.
 * Each tool is an interactive command executor, not a CRUD panel.
 */

import { useState } from 'react'
import type { ConfigPanelProps } from '@/lib/configPanelTypes'
import { PingTool } from './PingTool'
import { TracerouteTool } from './TracerouteTool'
import { BandwidthTestTool } from './BandwidthTestTool'
import { TorchTool } from './TorchTool'
import { cn } from '@/lib/utils'

const TOOLS = [
  { id: 'ping', label: 'Ping' },
  { id: 'traceroute', label: 'Traceroute' },
  { id: 'bw-test', label: 'BW Test' },
  { id: 'torch', label: 'Torch' },
] as const

type ToolId = (typeof TOOLS)[number]['id']

export function NetworkToolsPanel(props: ConfigPanelProps) {
  const [activeTool, setActiveTool] = useState<ToolId>('ping')

  return (
    <div className="space-y-4">
      {/* Sub-tab selector */}
      <div className="flex gap-1 border-b border-border">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
              activeTool === tool.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {activeTool === 'ping' && <PingTool {...props} />}
      {activeTool === 'traceroute' && <TracerouteTool {...props} />}
      {activeTool === 'bw-test' && <BandwidthTestTool {...props} />}
      {activeTool === 'torch' && <TorchTool {...props} />}
    </div>
  )
}
