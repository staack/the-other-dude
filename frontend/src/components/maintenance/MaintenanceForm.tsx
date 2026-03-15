/**
 * MaintenanceForm -- Dialog-based form for creating/editing maintenance windows.
 *
 * Supports device multi-select (or "All Devices" checkbox), datetime range,
 * suppress alerts toggle, and notes.
 */

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/toast'
import {
  maintenanceApi,
  devicesApi,
  type MaintenanceWindow,
  type MaintenanceWindowCreate,
} from '@/lib/api'

interface MaintenanceFormProps {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  editWindow?: MaintenanceWindow | null
}

export function MaintenanceForm({
  tenantId,
  open,
  onOpenChange,
  editWindow,
}: MaintenanceFormProps) {
  const queryClient = useQueryClient()
  const isEdit = !!editWindow

  const [name, setName] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [suppressAlerts, setSuppressAlerts] = useState(true)
  const [notes, setNotes] = useState('')
  const [allDevices, setAllDevices] = useState(true)
  const [selectedDevices, setSelectedDevices] = useState<string[]>([])

  // Fetch devices for multi-select
  const { data: deviceData } = useQuery({
    queryKey: ['devices', tenantId, 'maintenance-form'],
    queryFn: () => devicesApi.list(tenantId, { page_size: 500 }),
    enabled: open && !!tenantId,
  })

  const devices = deviceData?.items ?? []

  function resetForm() {
    setName('')
    setStartAt('')
    setEndAt('')
    setSuppressAlerts(true)
    setNotes('')
    setAllDevices(true)
    setSelectedDevices([])
  }

  function toDatetimeLocal(iso: string): string {
    const d = new Date(iso)
    const offset = d.getTimezoneOffset()
    const local = new Date(d.getTime() - offset * 60000)
    return local.toISOString().slice(0, 16)
  }

  // Populate form when editing
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (editWindow) {
      setName(editWindow.name)
      // Convert ISO to datetime-local format
      setStartAt(toDatetimeLocal(editWindow.start_at))
      setEndAt(toDatetimeLocal(editWindow.end_at))
      setSuppressAlerts(editWindow.suppress_alerts)
      setNotes(editWindow.notes ?? '')
      const hasDevices = editWindow.device_ids.length > 0
      setAllDevices(!hasDevices)
      setSelectedDevices(hasDevices ? editWindow.device_ids : [])
    } else {
      resetForm()
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [editWindow, open])

  const createMutation = useMutation({
    mutationFn: (data: MaintenanceWindowCreate) =>
      maintenanceApi.create(tenantId, data),
    onSuccess: () => {
      toast({ title: 'Maintenance window created' })
      queryClient.invalidateQueries({ queryKey: ['maintenance-windows', tenantId] })
      onOpenChange(false)
      resetForm()
    },
    onError: () => {
      toast({ title: 'Failed to create maintenance window', variant: 'destructive' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: MaintenanceWindowCreate) =>
      maintenanceApi.update(tenantId, editWindow!.id, data),
    onSuccess: () => {
      toast({ title: 'Maintenance window updated' })
      queryClient.invalidateQueries({ queryKey: ['maintenance-windows', tenantId] })
      onOpenChange(false)
    },
    onError: () => {
      toast({ title: 'Failed to update maintenance window', variant: 'destructive' })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validation
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' })
      return
    }
    if (!startAt || !endAt) {
      toast({ title: 'Start and end times are required', variant: 'destructive' })
      return
    }
    if (new Date(endAt) <= new Date(startAt)) {
      toast({ title: 'End time must be after start time', variant: 'destructive' })
      return
    }
    if (!allDevices && selectedDevices.length === 0) {
      toast({
        title: 'Select at least one device or choose "All Devices"',
        variant: 'destructive',
      })
      return
    }

    const data: MaintenanceWindowCreate = {
      name: name.trim(),
      device_ids: allDevices ? [] : selectedDevices,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      suppress_alerts: suppressAlerts,
      notes: notes.trim() || undefined,
    }

    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  function toggleDevice(deviceId: string) {
    setSelectedDevices((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId],
    )
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Maintenance Window' : 'New Maintenance Window'}
          </DialogTitle>
          <DialogDescription>
            Schedule a maintenance window to suppress alerts during planned downtime.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="mw-name">Name</Label>
            <Input
              id="mw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Firmware upgrade - Branch offices"
              autoFocus
            />
          </div>

          {/* Start / End */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mw-start">Start</Label>
              <Input
                id="mw-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mw-end">End</Label>
              <Input
                id="mw-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>

          {/* Suppress Alerts */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="mw-suppress"
              checked={suppressAlerts}
              onCheckedChange={(checked) => setSuppressAlerts(checked === true)}
            />
            <Label htmlFor="mw-suppress" className="cursor-pointer">
              Suppress alerts during this window
            </Label>
          </div>

          {/* Device Selection */}
          <div className="space-y-2">
            <Label>Devices</Label>
            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                id="mw-all-devices"
                checked={allDevices}
                onCheckedChange={(checked) => {
                  setAllDevices(checked === true)
                  if (checked) setSelectedDevices([])
                }}
              />
              <Label htmlFor="mw-all-devices" className="cursor-pointer">
                All devices in tenant
              </Label>
            </div>

            {!allDevices && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-elevated/30 p-2 space-y-1">
                {devices.length === 0 ? (
                  <p className="text-xs text-text-muted py-2 text-center">
                    No devices found
                  </p>
                ) : (
                  devices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-elevated/50"
                    >
                      <Checkbox
                        id={`dev-${device.id}`}
                        checked={selectedDevices.includes(device.id)}
                        onCheckedChange={() => toggleDevice(device.id)}
                      />
                      <Label
                        htmlFor={`dev-${device.id}`}
                        className="cursor-pointer flex-1 text-xs"
                      >
                        {device.hostname}{' '}
                        <span className="text-text-muted">({device.ip_address})</span>
                      </Label>
                    </div>
                  ))
                )}
              </div>
            )}
            {!allDevices && selectedDevices.length > 0 && (
              <p className="text-xs text-text-muted">
                {selectedDevices.length} device{selectedDevices.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="mw-notes">Notes (optional)</Label>
            <textarea
              id="mw-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for maintenance, ticket number, etc."
              rows={2}
              className="w-full rounded-md border border-border bg-elevated/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading
                ? isEdit
                  ? 'Updating...'
                  : 'Creating...'
                : isEdit
                  ? 'Update Window'
                  : 'Create Window'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
