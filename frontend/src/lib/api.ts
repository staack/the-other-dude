import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

// Singleton to track in-flight refresh to prevent multiple simultaneous refresh calls
let refreshPromise: Promise<void> | null = null

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: BASE_URL,
    withCredentials: true, // Send httpOnly cookies automatically
    headers: {
      'Content-Type': 'application/json',
    },
  })

  // Response interceptor: handle 401 by attempting token refresh
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true

        // Don't try to refresh if this IS the refresh request or login request
        const url = originalRequest.url ?? ''
        if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
          return Promise.reject(error as Error)
        }

        if (!refreshPromise) {
          refreshPromise = client
            .post('/api/auth/refresh')
            .then(() => {
              refreshPromise = null
            })
            .catch(() => {
              refreshPromise = null
              return Promise.reject(error as Error)
            })
        }

        try {
          await refreshPromise
          return client(originalRequest)
        } catch {
          return Promise.reject(error as Error)
        }
      }

      return Promise.reject(error as Error)
    },
  )

  return client
}

export const api = createApiClient()

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  auth_upgrade_required?: boolean
}

export interface UserMe {
  id: string
  email: string
  name: string
  role: string
  tenant_id: string | null
  auth_version: number
}

export interface MessageResponse {
  message: string
}

// SRP Authentication types
export interface SRPInitResponse {
  salt: string
  server_public: string
  session_id: string
  pbkdf2_salt: string // base64-encoded, from user_key_sets
  hkdf_salt: string // base64-encoded, from user_key_sets
}

export interface SRPVerifyResponse {
  access_token: string
  refresh_token: string
  token_type: string
  server_proof: string
  encrypted_key_set: {
    encrypted_private_key: string // base64
    private_key_nonce: string // base64
    encrypted_vault_key: string // base64
    vault_key_nonce: string // base64
    public_key: string // base64
    pbkdf2_salt: string // base64
    hkdf_salt: string // base64
    pbkdf2_iterations: number
  } | null
}

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<TokenResponse>('/api/auth/login', data).then((r) => r.data),

  logout: () => api.post('/api/auth/logout').then((r) => r.data),

  me: () => api.get<UserMe>('/api/auth/me').then((r) => r.data),

  refresh: () => api.post<TokenResponse>('/api/auth/refresh').then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post<MessageResponse>('/api/auth/forgot-password', { email }).then((r) => r.data),

  resetPassword: (token: string, newPassword: string) =>
    api
      .post<MessageResponse>('/api/auth/reset-password', {
        token,
        new_password: newPassword,
      })
      .then((r) => r.data),

  srpInit: async (email: string): Promise<SRPInitResponse> => {
    const { data } = await api.post<SRPInitResponse>('/api/auth/srp/init', { email })
    return data
  },

  srpVerify: async (params: {
    email: string
    session_id: string
    client_public: string
    client_proof: string
  }): Promise<SRPVerifyResponse> => {
    const { data } = await api.post<SRPVerifyResponse>('/api/auth/srp/verify', params)
    return data
  },

  registerSRP: async (params: {
    srp_salt: string
    srp_verifier: string
    encrypted_private_key: string
    private_key_nonce: string
    encrypted_vault_key: string
    vault_key_nonce: string
    public_key: string
    pbkdf2_salt: string
    hkdf_salt: string
  }): Promise<MessageResponse> => {
    const { data } = await api.post<MessageResponse>('/api/auth/register-srp', params)
    return data
  },

  getEmergencyKitPDF: async (): Promise<Blob> => {
    const { data } = await api.get('/api/auth/emergency-kit-template', {
      responseType: 'blob',
    })
    return data as Blob
  },

  changePassword: async (params: {
    current_password: string
    new_password: string
    new_srp_salt?: string
    new_srp_verifier?: string
    encrypted_private_key?: string
    private_key_nonce?: string
    encrypted_vault_key?: string
    vault_key_nonce?: string
    public_key?: string
    pbkdf2_salt?: string
    hkdf_salt?: string
  }): Promise<MessageResponse> => {
    const { data } = await api.post<MessageResponse>('/api/auth/change-password', params)
    return data
  },

  deleteMyAccount: async (confirmation: string): Promise<MessageResponse> => {
    const { data } = await api.delete<MessageResponse>('/api/auth/delete-my-account', {
      data: { confirmation },
    })
    return data
  },

  exportMyData: async (): Promise<void> => {
    const response = await api.get('/api/auth/export-my-data', {
      responseType: 'blob',
    })
    const blob = new Blob([response.data as BlobPart], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'my-data-export.json'
    a.click()
    window.URL.revokeObjectURL(url)
  },
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

export interface TenantResponse {
  id: string
  name: string
  description: string | null
  contact_email: string | null
  user_count: number
  device_count: number
  created_at: string
}

export interface TenantCreate {
  name: string
  description?: string
  contact_email?: string
}

export const tenantsApi = {
  list: () => api.get<TenantResponse[]>('/api/tenants').then((r) => r.data),

  get: (id: string) => api.get<TenantResponse>(`/api/tenants/${id}`).then((r) => r.data),

  create: (data: TenantCreate) =>
    api.post<TenantResponse>('/api/tenants', data).then((r) => r.data),

  update: (id: string, data: Partial<TenantCreate>) =>
    api.put<TenantResponse>(`/api/tenants/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/api/tenants/${id}`).then((r) => r.data),
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string
  name: string
  email: string
  role: string
  tenant_id: string | null
  is_active: boolean
  last_login: string | null
  created_at: string
}

export interface UserCreate {
  name: string
  email: string
  password: string
  role: string
}

export const usersApi = {
  list: (tenantId: string) =>
    api.get<UserResponse[]>(`/api/tenants/${tenantId}/users`).then((r) => r.data),

  create: (tenantId: string, data: UserCreate) =>
    api.post<UserResponse>(`/api/tenants/${tenantId}/users`, data).then((r) => r.data),

  update: (tenantId: string, userId: string, data: Partial<UserCreate>) =>
    api
      .put<UserResponse>(`/api/tenants/${tenantId}/users/${userId}`, data)
      .then((r) => r.data),

  deactivate: (tenantId: string, userId: string) =>
    api.delete(`/api/tenants/${tenantId}/users/${userId}`).then((r) => r.data),
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export interface DeviceTagRef {
  id: string
  name: string
  color: string | null
}

export interface DeviceGroupRef {
  id: string
  name: string
}

export interface DeviceResponse {
  id: string
  hostname: string
  ip_address: string
  api_port: number
  api_ssl_port: number
  model: string | null
  serial_number: string | null
  firmware_version: string | null
  routeros_version: string | null
  uptime_seconds: number | null
  last_seen: string | null
  latitude: number | null
  longitude: number | null
  status: string
  tls_mode: string
  tags: DeviceTagRef[]
  groups: DeviceGroupRef[]
  site_id: string | null
  site_name: string | null
  created_at: string
}

export interface DeviceListResponse {
  items: DeviceResponse[]
  total: number
  page: number
  page_size: number
}

export interface DeviceCreate {
  hostname: string
  ip_address: string
  api_port?: number
  api_ssl_port?: number
  username: string
  password: string
}

export interface DeviceUpdate {
  hostname?: string
  ip_address?: string
  api_port?: number
  api_ssl_port?: number
  username?: string
  password?: string
  latitude?: number | null
  longitude?: number | null
  tls_mode?: string
}

export interface DeviceListParams {
  page?: number
  page_size?: number
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
  search?: string
  status?: string
  model?: string
  tag?: string
}

export const devicesApi = {
  list: (tenantId: string, params?: DeviceListParams) =>
    api
      .get<DeviceListResponse>(`/api/tenants/${tenantId}/devices`, { params })
      .then((r) => r.data),

  get: (tenantId: string, deviceId: string) =>
    api
      .get<DeviceResponse>(`/api/tenants/${tenantId}/devices/${deviceId}`)
      .then((r) => r.data),

  create: (tenantId: string, data: DeviceCreate) =>
    api
      .post<DeviceResponse>(`/api/tenants/${tenantId}/devices`, data)
      .then((r) => r.data),

  update: (tenantId: string, deviceId: string, data: DeviceUpdate) =>
    api
      .put<DeviceResponse>(`/api/tenants/${tenantId}/devices/${deviceId}`, data)
      .then((r) => r.data),

  delete: (tenantId: string, deviceId: string) =>
    api.delete(`/api/tenants/${tenantId}/devices/${deviceId}`).then((r) => r.data),

  scan: (tenantId: string, cidr: string) =>
    api
      .post<SubnetScanResponse>(`/api/tenants/${tenantId}/devices/scan`, { cidr })
      .then((r) => r.data),

  bulkAdd: (tenantId: string, data: BulkAddRequest) =>
    api
      .post<BulkAddResult>(`/api/tenants/${tenantId}/devices/bulk-add`, data)
      .then((r) => r.data),

  addToGroup: (tenantId: string, deviceId: string, groupId: string) =>
    api
      .post(`/api/tenants/${tenantId}/devices/${deviceId}/groups/${groupId}`)
      .then((r) => r.data),

  removeFromGroup: (tenantId: string, deviceId: string, groupId: string) =>
    api
      .delete(`/api/tenants/${tenantId}/devices/${deviceId}/groups/${groupId}`)
      .then((r) => r.data),

  addTag: (tenantId: string, deviceId: string, tagId: string) =>
    api
      .post(`/api/tenants/${tenantId}/devices/${deviceId}/tags/${tagId}`)
      .then((r) => r.data),

  removeTag: (tenantId: string, deviceId: string, tagId: string) =>
    api
      .delete(`/api/tenants/${tenantId}/devices/${deviceId}/tags/${tagId}`)
      .then((r) => r.data),
}

// ─── Subnet scan types ────────────────────────────────────────────────────────

export interface SubnetScanResult {
  ip_address: string
  hostname: string | null
  api_port_open: boolean
  api_ssl_port_open: boolean
}

export interface SubnetScanResponse {
  cidr: string
  discovered: SubnetScanResult[]
  total_scanned: number
  total_discovered: number
}

export interface BulkDeviceAdd {
  ip_address: string
  hostname?: string
  api_port?: number
  api_ssl_port?: number
  username?: string
  password?: string
}

export interface BulkAddRequest {
  devices: BulkDeviceAdd[]
  shared_username?: string
  shared_password?: string
}

export interface BulkAddResult {
  added: DeviceResponse[]
  failed: Array<{ ip_address: string; error: string }>
}

// ─── Device Groups ────────────────────────────────────────────────────────────

export interface DeviceGroupResponse {
  id: string
  name: string
  description: string | null
  device_count: number
  created_at: string
}

export interface DeviceGroupCreate {
  name: string
  description?: string
}

export const deviceGroupsApi = {
  list: (tenantId: string) =>
    api.get<DeviceGroupResponse[]>(`/api/tenants/${tenantId}/device-groups`).then((r) => r.data),

  create: (tenantId: string, data: DeviceGroupCreate) =>
    api
      .post<DeviceGroupResponse>(`/api/tenants/${tenantId}/device-groups`, data)
      .then((r) => r.data),

  delete: (tenantId: string, groupId: string) =>
    api.delete(`/api/tenants/${tenantId}/device-groups/${groupId}`).then((r) => r.data),
}

// ─── Device Tags ──────────────────────────────────────────────────────────────

export interface DeviceTagResponse {
  id: string
  name: string
  color: string | null
}

export interface DeviceTagCreate {
  name: string
  color?: string
}

export const deviceTagsApi = {
  list: (tenantId: string) =>
    api.get<DeviceTagResponse[]>(`/api/tenants/${tenantId}/device-tags`).then((r) => r.data),

  create: (tenantId: string, data: DeviceTagCreate) =>
    api
      .post<DeviceTagResponse>(`/api/tenants/${tenantId}/device-tags`, data)
      .then((r) => r.data),

  delete: (tenantId: string, tagId: string) =>
    api.delete(`/api/tenants/${tenantId}/device-tags/${tagId}`).then((r) => r.data),
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export interface SiteResponse {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  address: string | null
  elevation: number | null
  notes: string | null
  device_count: number
  online_count: number
  online_percent: number
  alert_count: number
  created_at: string
  updated_at: string
}

export interface SiteListResponse {
  sites: SiteResponse[]
  unassigned_count: number
}

export interface SiteCreate {
  name: string
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  elevation?: number | null
  notes?: string | null
}

export interface SiteUpdate {
  name?: string
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  elevation?: number | null
  notes?: string | null
}

export const sitesApi = {
  list: (tenantId: string) =>
    api.get<SiteListResponse>(`/api/tenants/${tenantId}/sites`).then((r) => r.data),

  get: (tenantId: string, siteId: string) =>
    api.get<SiteResponse>(`/api/tenants/${tenantId}/sites/${siteId}`).then((r) => r.data),

  create: (tenantId: string, data: SiteCreate) =>
    api.post<SiteResponse>(`/api/tenants/${tenantId}/sites`, data).then((r) => r.data),

  update: (tenantId: string, siteId: string, data: SiteUpdate) =>
    api.put<SiteResponse>(`/api/tenants/${tenantId}/sites/${siteId}`, data).then((r) => r.data),

  delete: (tenantId: string, siteId: string) =>
    api.delete(`/api/tenants/${tenantId}/sites/${siteId}`).then((r) => r.data),

  assignDevice: (tenantId: string, siteId: string, deviceId: string) =>
    api.post(`/api/tenants/${tenantId}/sites/${siteId}/devices/${deviceId}`).then((r) => r.data),

  removeDevice: (tenantId: string, siteId: string, deviceId: string) =>
    api.delete(`/api/tenants/${tenantId}/sites/${siteId}/devices/${deviceId}`).then((r) => r.data),

  bulkAssign: (tenantId: string, siteId: string, deviceIds: string[]) =>
    api
      .post<{ assigned: number }>(`/api/tenants/${tenantId}/sites/${siteId}/devices/bulk-assign`, {
        device_ids: deviceIds,
      })
      .then((r) => r.data),
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface HealthMetricPoint {
  bucket: string // ISO timestamp
  avg_cpu: number | null
  max_cpu: number | null
  avg_mem_pct: number | null
  avg_disk_pct: number | null
  avg_temp: number | null
}

export interface InterfaceMetricPoint {
  bucket: string
  interface: string
  avg_rx_bps: number | null
  avg_tx_bps: number | null
  max_rx_bps: number | null
  max_tx_bps: number | null
}

export interface WirelessMetricPoint {
  bucket: string
  interface: string
  avg_clients: number | null
  max_clients: number | null
  avg_signal: number | null
  avg_ccq: number | null
  frequency: number | null
}

export interface WirelessLatest {
  interface: string
  client_count: number | null
  avg_signal: number | null
  ccq: number | null
  frequency: number | null
  time: string
}

export interface WirelessIssue {
  device_id: string
  hostname: string
  tenant_name?: string
  interface: string
  issue: string
  signal: number | null
  ccq: number | null
  client_count: number
  frequency: number
}

export interface FleetDevice {
  id: string
  hostname: string
  ip_address: string
  status: string
  model: string | null
  last_seen: string | null
  uptime_seconds: number | null
  last_cpu_load: number | null
  last_memory_used_pct: number | null
  latitude: number | null
  longitude: number | null
  tenant_id: string
  tenant_name: string
}

export interface SparklinePoint {
  cpu_load: number | null
  time: string
}

// ─── Config Backups ───────────────────────────────────────────────────────────

export interface ConfigBackupEntry {
  id: string
  commit_sha: string
  trigger_type: 'scheduled' | 'manual' | 'pre-restore' | 'checkpoint' | 'config-change'
  lines_added: number | null
  lines_removed: number | null
  encryption_tier: number | null
  created_at: string
}

export interface RestoreResult {
  status: 'committed' | 'reverted' | 'failed'
  message: string
  pre_backup_sha?: string
}

export interface RestorePreview {
  diff: { added: number; removed: number; modified: number }
  categories: Array<{
    path: string
    adds: number
    removes: number
    risk: 'none' | 'low' | 'medium' | 'high'
  }>
  warnings: string[]
  validation: { valid: boolean; errors: string[] }
}

export interface BackupSchedule {
  id: string | null
  cron_expression: string
  enabled: boolean
  device_id: string | null
  is_default?: boolean
}

export const configApi = {
  listBackups: (tenantId: string, deviceId: string) =>
    api
      .get<ConfigBackupEntry[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/backups`,
      )
      .then((r) => r.data),

  triggerBackup: (tenantId: string, deviceId: string) =>
    api
      .post<ConfigBackupEntry>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/backups`,
      )
      .then((r) => r.data),

  createCheckpoint: (tenantId: string, deviceId: string) =>
    api
      .post<ConfigBackupEntry>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/checkpoint`,
      )
      .then((r) => r.data),

  getExportText: (tenantId: string, deviceId: string, commitSha: string) =>
    api
      .get<string>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/backups/${commitSha}/export`,
        { responseType: 'text' },
      )
      .then((r) => r.data),

  downloadBinary: (tenantId: string, deviceId: string, commitSha: string) =>
    api
      .get<Blob>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/backups/${commitSha}/binary`,
        { responseType: 'blob' },
      )
      .then((r) => r.data),

  restore: (tenantId: string, deviceId: string, commitSha: string) =>
    api
      .post<RestoreResult>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/restore`,
        { commit_sha: commitSha },
      )
      .then((r) => r.data),

  previewRestore: (tenantId: string, deviceId: string, commitSha: string) =>
    api
      .post<RestorePreview>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/preview-restore`,
        { commit_sha: commitSha },
      )
      .then((r) => r.data),

  emergencyRollback: (tenantId: string, deviceId: string) =>
    api
      .post<
        RestoreResult & { rolled_back_to: string; rolled_back_to_date: string }
      >(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/emergency-rollback`,
      )
      .then((r) => r.data),

  getSchedule: (tenantId: string, deviceId: string) =>
    api
      .get<BackupSchedule>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/schedules`,
      )
      .then((r) => r.data),

  updateSchedule: (
    tenantId: string,
    deviceId: string,
    data: Partial<BackupSchedule>,
  ) =>
    api
      .put<BackupSchedule>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/schedules`,
        data,
      )
      .then((r) => r.data),
}

/**
 * Get a fresh access token for SSE connections.
 * The refresh token is in httpOnly cookie, so just call the endpoint.
 */
export async function getAccessToken(): Promise<string> {
  const response = await authApi.refresh()
  return response.access_token
}

export const metricsApi = {
  health: (tenantId: string, deviceId: string, start: string, end: string) =>
    api
      .get<HealthMetricPoint[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/metrics/health`,
        { params: { start, end } },
      )
      .then((r) => r.data),

  interfaces: (
    tenantId: string,
    deviceId: string,
    start: string,
    end: string,
    iface?: string,
  ) =>
    api
      .get<InterfaceMetricPoint[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/metrics/interfaces`,
        { params: { start, end, ...(iface ? { interface: iface } : {}) } },
      )
      .then((r) => r.data),

  interfaceList: (tenantId: string, deviceId: string) =>
    api
      .get<string[]>(`/api/tenants/${tenantId}/devices/${deviceId}/metrics/interfaces/list`)
      .then((r) => r.data),

  wireless: (tenantId: string, deviceId: string, start: string, end: string) =>
    api
      .get<WirelessMetricPoint[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/metrics/wireless`,
        { params: { start, end } },
      )
      .then((r) => r.data),

  wirelessLatest: (tenantId: string, deviceId: string) =>
    api
      .get<WirelessLatest[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/metrics/wireless/latest`,
      )
      .then((r) => r.data),

  fleetSummary: (tenantId: string) =>
    api
      .get<FleetDevice[]>(`/api/tenants/${tenantId}/fleet/summary`)
      .then((r) => r.data),

  /** Cross-tenant fleet summary for super_admin users */
  fleetSummaryAll: () =>
    api.get<FleetDevice[]>(`/api/fleet/summary`).then((r) => r.data),

  wirelessIssues: (tenantId: string) =>
    api
      .get<WirelessIssue[]>(`/api/tenants/${tenantId}/fleet/wireless-issues`)
      .then((r) => r.data),

  fleetWirelessIssues: () =>
    api.get<WirelessIssue[]>(`/api/fleet/wireless-issues`).then((r) => r.data),

  sparkline: (tenantId: string, deviceId: string) =>
    api
      .get<SparklinePoint[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/metrics/sparkline`,
      )
      .then((r) => r.data),
}

// ─── Maintenance Windows ────────────────────────────────────────────────────

export interface MaintenanceWindow {
  id: string
  tenant_id: string
  name: string
  device_ids: string[]
  start_at: string
  end_at: string
  suppress_alerts: boolean
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface MaintenanceWindowCreate {
  name: string
  device_ids: string[]
  start_at: string
  end_at: string
  suppress_alerts: boolean
  notes?: string
}

export interface MaintenanceWindowUpdate {
  name?: string
  device_ids?: string[]
  start_at?: string
  end_at?: string
  suppress_alerts?: boolean
  notes?: string
}

export const maintenanceApi = {
  list: (tenantId: string, status?: string) =>
    api
      .get<MaintenanceWindow[]>(
        `/api/tenants/${tenantId}/maintenance-windows`,
        { params: status ? { status } : {} },
      )
      .then((r) => r.data),

  create: (tenantId: string, data: MaintenanceWindowCreate) =>
    api
      .post<MaintenanceWindow>(
        `/api/tenants/${tenantId}/maintenance-windows`,
        data,
      )
      .then((r) => r.data),

  update: (tenantId: string, windowId: string, data: MaintenanceWindowUpdate) =>
    api
      .put<MaintenanceWindow>(
        `/api/tenants/${tenantId}/maintenance-windows/${windowId}`,
        data,
      )
      .then((r) => r.data),

  delete: (tenantId: string, windowId: string) =>
    api
      .delete(`/api/tenants/${tenantId}/maintenance-windows/${windowId}`)
      .then((r) => r.data),
}

// ─── Audit Logs ──────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string
  user_email: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  device_id: string | null
  device_name: string | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export interface AuditLogResponse {
  items: AuditLogEntry[]
  total: number
  page: number
  per_page: number
}

export interface AuditLogParams {
  page?: number
  per_page?: number
  action?: string
  user_id?: string
  device_id?: string
  date_from?: string
  date_to?: string
}

export const auditLogsApi = {
  list: (tenantId: string, params?: AuditLogParams) =>
    api
      .get<AuditLogResponse>(`/api/tenants/${tenantId}/audit-logs`, { params })
      .then((r) => r.data),

  exportCsv: async (tenantId: string, params?: AuditLogParams) => {
    const response = await api.get(`/api/tenants/${tenantId}/audit-logs`, {
      params: { ...params, format: 'csv' },
      responseType: 'blob',
    })
    const blob = new Blob([response.data as BlobPart], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit-logs.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  },
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ReportRequest {
  type: 'device_inventory' | 'metrics_summary' | 'alert_history' | 'change_log'
  date_from?: string
  date_to?: string
  format: 'pdf' | 'csv'
}

export const reportsApi = {
  generate: async (tenantId: string, request: ReportRequest) => {
    const response = await api.post(
      `/api/tenants/${tenantId}/reports/generate`,
      request,
      { responseType: 'blob' },
    )
    // Extract filename from Content-Disposition header
    const disposition = response.headers['content-disposition'] ?? ''
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
    const filename = filenameMatch
      ? filenameMatch[1]
      : `report.${request.format === 'csv' ? 'csv' : 'pdf'}`

    // Trigger browser download
    const blob = new Blob([response.data as BlobPart], {
      type: request.format === 'csv' ? 'text/csv' : 'application/pdf',
    })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  },
}

// ─── API Keys ──────────────────────────────────────────────────────────────

export interface ApiKeyResponse {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

export interface ApiKeyCreateResponse extends ApiKeyResponse {
  key: string
}

export interface ApiKeyCreate {
  name: string
  scopes: string[]
  expires_at?: string
}

export const apiKeysApi = {
  list: (tenantId: string) =>
    api.get<ApiKeyResponse[]>(`/api/tenants/${tenantId}/api-keys`).then((r) => r.data),

  create: (tenantId: string, data: ApiKeyCreate) =>
    api
      .post<ApiKeyCreateResponse>(`/api/tenants/${tenantId}/api-keys`, data)
      .then((r) => r.data),

  revoke: (tenantId: string, keyId: string) =>
    api.delete(`/api/tenants/${tenantId}/api-keys/${keyId}`).then((r) => r.data),
}

// ─── Remote Access ───────────────────────────────────────────────────────────

export const remoteAccessApi = {
  openWinbox: (tenantId: string, deviceId: string) =>
    api
      .post<{
        tunnel_id: string
        host: string
        port: number
        winbox_uri: string
        idle_timeout_seconds: number
      }>(`/api/tenants/${tenantId}/devices/${deviceId}/winbox-session`)
      .then((r) => r.data),

  closeWinbox: (tenantId: string, deviceId: string, tunnelId: string) =>
    api
      .delete(`/api/tenants/${tenantId}/devices/${deviceId}/winbox-session/${tunnelId}`)
      .then((r) => r.data),

  openSSH: (tenantId: string, deviceId: string, cols: number, rows: number) =>
    api
      .post<{
        token: string
        websocket_url: string
        idle_timeout_seconds: number
      }>(`/api/tenants/${tenantId}/devices/${deviceId}/ssh-session`, { cols, rows })
      .then((r) => r.data),

  getSessions: (tenantId: string, deviceId: string) =>
    api
      .get<{
        winbox_tunnels: Array<{ tunnel_id: string; local_port: number; idle_seconds: number; created_at: string }>
        ssh_sessions: Array<{ session_id: string; idle_seconds: number; created_at: string }>
      }>(`/api/tenants/${tenantId}/devices/${deviceId}/sessions`)
      .then((r) => r.data),
}

// ─── Remote WinBox (Browser) ─────────────────────────────────────────────────

export interface RemoteWinBoxSession {
  session_id: string
  status: 'creating' | 'active' | 'grace' | 'terminating' | 'terminated' | 'failed'
  websocket_path?: string
  xpra_ws_port?: number
  idle_timeout_seconds: number
  max_lifetime_seconds: number
  expires_at: string
  max_expires_at: string
  created_at?: string
}

export const remoteWinboxApi = {
  create: (tenantId: string, deviceId: string, opts?: {
    idle_timeout_seconds?: number
    max_lifetime_seconds?: number
  }) =>
    api
      .post<RemoteWinBoxSession>(
        `/api/tenants/${tenantId}/devices/${deviceId}/winbox-remote-sessions`,
        opts || {},
      )
      .then((r) => r.data),

  get: (tenantId: string, deviceId: string, sessionId: string) =>
    api
      .get<RemoteWinBoxSession>(
        `/api/tenants/${tenantId}/devices/${deviceId}/winbox-remote-sessions/${sessionId}`,
      )
      .then((r) => r.data),

  list: (tenantId: string, deviceId: string) =>
    api
      .get<RemoteWinBoxSession[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/winbox-remote-sessions`,
      )
      .then((r) => r.data),

  delete: (tenantId: string, deviceId: string, sessionId: string) =>
    api
      .delete(
        `/api/tenants/${tenantId}/devices/${deviceId}/winbox-remote-sessions/${sessionId}`,
      )
      .then((r) => r.data),

  getWebSocketUrl: (sessionPath: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}${sessionPath}`
  },
}

// ─── Config History ─────────────────────────────────────────────────────────

export interface ConfigChangeEntry {
  id: string
  component: string
  summary: string
  created_at: string
  diff_id: string
  lines_added: number
  lines_removed: number
  snapshot_id: string
}

export interface DiffResponse {
  id: string
  diff_text: string
  lines_added: number
  lines_removed: number
  old_snapshot_id: string
  new_snapshot_id: string
  created_at: string
}

export interface SnapshotResponse {
  id: string
  config_text: string
  sha256_hash: string
  collected_at: string
}

export const configHistoryApi = {
  list: (tenantId: string, deviceId: string, limit = 50, offset = 0) =>
    api
      .get<ConfigChangeEntry[]>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config-history`,
        { params: { limit, offset } },
      )
      .then((r) => r.data),

  getDiff: (tenantId: string, deviceId: string, snapshotId: string) =>
    api
      .get<DiffResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/${snapshotId}/diff`,
      )
      .then((r) => r.data),

  getSnapshot: (tenantId: string, deviceId: string, snapshotId: string) =>
    api
      .get<SnapshotResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config/${snapshotId}`,
      )
      .then((r) => r.data),
}

// ─── VPN (WireGuard) ────────────────────────────────────────────────────────

export interface VpnConfigResponse {
  id: string
  tenant_id: string
  server_public_key: string
  subnet: string
  server_port: number
  server_address: string
  endpoint: string | null
  is_enabled: boolean
  peer_count: number
  created_at: string
}

export interface VpnPeerResponse {
  id: string
  device_id: string
  device_hostname: string
  device_ip: string
  peer_public_key: string
  assigned_ip: string
  is_enabled: boolean
  last_handshake: string | null
  created_at: string
}

export interface VpnOnboardRequest {
  hostname: string
  username: string
  password: string
}

export interface VpnOnboardResponse {
  device_id: string
  peer_id: string
  hostname: string
  assigned_ip: string
  routeros_commands: string[]
}

export interface VpnPeerConfig {
  peer_private_key: string
  peer_public_key: string
  assigned_ip: string
  server_public_key: string
  server_endpoint: string
  allowed_ips: string
  routeros_commands: string[]
}

export const vpnApi = {
  getConfig: (tenantId: string) =>
    api.get<VpnConfigResponse | null>(`/api/tenants/${tenantId}/vpn`).then((r) => r.data),

  setup: (tenantId: string, endpoint?: string) =>
    api.post<VpnConfigResponse>(`/api/tenants/${tenantId}/vpn`, { endpoint }).then((r) => r.data),

  updateConfig: (tenantId: string, data: { endpoint?: string; is_enabled?: boolean }) =>
    api.patch<VpnConfigResponse>(`/api/tenants/${tenantId}/vpn`, data).then((r) => r.data),

  deleteConfig: (tenantId: string) =>
    api.delete(`/api/tenants/${tenantId}/vpn`),

  listPeers: (tenantId: string) =>
    api.get<VpnPeerResponse[]>(`/api/tenants/${tenantId}/vpn/peers`).then((r) => r.data),

  addPeer: (tenantId: string, deviceId: string) =>
    api.post<VpnPeerResponse>(`/api/tenants/${tenantId}/vpn/peers`, { device_id: deviceId }).then((r) => r.data),

  removePeer: (tenantId: string, peerId: string) =>
    api.delete(`/api/tenants/${tenantId}/vpn/peers/${peerId}`).then((r) => r.data),

  getPeerConfig: (tenantId: string, peerId: string) =>
    api.get<VpnPeerConfig>(`/api/tenants/${tenantId}/vpn/peers/${peerId}/config`).then((r) => r.data),

  onboard: (tenantId: string, data: VpnOnboardRequest) =>
    api.post<VpnOnboardResponse>(`/api/tenants/${tenantId}/vpn/peers/onboard`, data).then((r) => r.data),
}
