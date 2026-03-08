/**
 * Firmware API client — TypeScript functions for firmware overview,
 * version management, upgrade orchestration, and scheduling.
 */

import { api } from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceFirmwareStatus {
  id: string
  hostname: string
  ip_address: string
  routeros_version: string | null
  architecture: string | null
  latest_version: string | null
  channel: string
  is_up_to_date: boolean
  serial_number: string | null
  firmware_version: string | null
  model: string | null
}

export interface FirmwareVersionGroup {
  version: string
  count: number
  is_latest: boolean
  devices: DeviceFirmwareStatus[]
}

export interface FirmwareOverview {
  devices: DeviceFirmwareStatus[]
  version_groups: FirmwareVersionGroup[]
  summary: { total: number; up_to_date: number; outdated: number; unknown: number }
}

export interface FirmwareUpgradeJob {
  id: string
  device_id: string
  device_hostname?: string
  rollout_group_id: string | null
  target_version: string
  architecture: string
  channel: string
  status:
    | 'pending'
    | 'scheduled'
    | 'downloading'
    | 'uploading'
    | 'rebooting'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'paused'
  pre_upgrade_backup_sha: string | null
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  confirmed_major_upgrade: boolean
  created_at: string
}

export interface UpgradeJobsResponse {
  items: FirmwareUpgradeJob[]
  total: number
  page: number
  per_page: number
}

export interface RolloutStatus {
  rollout_group_id: string
  total: number
  completed: number
  failed: number
  paused: number
  pending: number
  current_device: string | null
  jobs: FirmwareUpgradeJob[]
}

export interface FirmwareVersion {
  id: string
  architecture: string
  channel: string
  version: string
  npk_url: string
  npk_local_path: string | null
  npk_size_bytes: number | null
  checked_at: string | null
}

export interface UpgradeRequestData {
  device_id: string
  target_version: string
  architecture: string
  channel?: string
  confirmed_major_upgrade?: boolean
  scheduled_at?: string | null
}

export interface MassUpgradeRequestData {
  device_ids: string[]
  target_version: string
  channel?: string
  confirmed_major_upgrade?: boolean
  scheduled_at?: string | null
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const firmwareApi = {
  // -- Overview --

  getFirmwareOverview: (tenantId: string) =>
    api
      .get<FirmwareOverview>(`/api/tenants/${tenantId}/firmware/overview`)
      .then((r) => r.data),

  getFirmwareVersions: (params?: { architecture?: string; channel?: string }) =>
    api
      .get<FirmwareVersion[]>('/api/firmware/versions', { params })
      .then((r) => r.data),

  // -- Upgrades --

  startUpgrade: (tenantId: string, data: UpgradeRequestData) =>
    api
      .post<{ status: string; job_id: string }>(
        `/api/tenants/${tenantId}/firmware/upgrade`,
        data,
      )
      .then((r) => r.data),

  startMassUpgrade: (tenantId: string, data: MassUpgradeRequestData) =>
    api
      .post<{ status: string; rollout_group_id: string; jobs: Array<{ job_id: string; device_id: string }> }>(
        `/api/tenants/${tenantId}/firmware/mass-upgrade`,
        data,
      )
      .then((r) => r.data),

  getUpgradeJobs: (
    tenantId: string,
    params?: { status?: string; device_id?: string; rollout_group_id?: string; page?: number },
  ) =>
    api
      .get<UpgradeJobsResponse>(`/api/tenants/${tenantId}/firmware/upgrades`, { params })
      .then((r) => r.data),

  getUpgradeJob: (tenantId: string, jobId: string) =>
    api
      .get<FirmwareUpgradeJob>(`/api/tenants/${tenantId}/firmware/upgrades/${jobId}`)
      .then((r) => r.data),

  getRolloutStatus: (tenantId: string, rolloutGroupId: string) =>
    api
      .get<RolloutStatus>(
        `/api/tenants/${tenantId}/firmware/rollouts/${rolloutGroupId}`,
      )
      .then((r) => r.data),

  cancelUpgrade: (tenantId: string, jobId: string) =>
    api
      .post<{ status: string }>(`/api/tenants/${tenantId}/firmware/upgrades/${jobId}/cancel`)
      .then((r) => r.data),

  retryUpgrade: (tenantId: string, jobId: string) =>
    api
      .post<{ status: string }>(`/api/tenants/${tenantId}/firmware/upgrades/${jobId}/retry`)
      .then((r) => r.data),

  resumeRollout: (tenantId: string, groupId: string) =>
    api
      .post<{ status: string }>(
        `/api/tenants/${tenantId}/firmware/rollouts/${groupId}/resume`,
      )
      .then((r) => r.data),

  abortRollout: (tenantId: string, groupId: string) =>
    api
      .post<{ status: string; aborted_count: number }>(
        `/api/tenants/${tenantId}/firmware/rollouts/${groupId}/abort`,
      )
      .then((r) => r.data),

  // -- Preferred channel --

  setDevicePreferredChannel: (tenantId: string, deviceId: string, channel: string) =>
    api
      .patch<{ status: string }>(`/api/tenants/${tenantId}/devices/${deviceId}/preferred-channel`, {
        preferred_channel: channel,
      })
      .then((r) => r.data),

  setGroupPreferredChannel: (tenantId: string, groupId: string, channel: string) =>
    api
      .patch<{ status: string }>(
        `/api/tenants/${tenantId}/device-groups/${groupId}/preferred-channel`,
        { preferred_channel: channel },
      )
      .then((r) => r.data),
}
