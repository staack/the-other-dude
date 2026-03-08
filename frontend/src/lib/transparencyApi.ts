/**
 * Transparency Log API client.
 *
 * Typed functions for the Data Access Transparency dashboard.
 * Follows the same pattern as auditLogsApi in api.ts.
 */

import { api } from './api'

export interface TransparencyLogEntry {
  id: string
  action: string
  device_name: string | null
  device_id: string | null
  justification: string | null
  operator_email: string | null
  correlation_id: string | null
  resource_type: string | null
  resource_id: string | null
  ip_address: string | null
  created_at: string
}

export interface TransparencyLogParams {
  page?: number
  per_page?: number
  device_id?: string
  justification?: string
  action?: string
  date_from?: string
  date_to?: string
}

export interface TransparencyLogResponse {
  items: TransparencyLogEntry[]
  total: number
  page: number
  per_page: number
}

export interface TransparencyStats {
  total_events: number
  events_last_24h: number
  unique_devices: number
  justification_breakdown: Record<string, number>
}

export const transparencyApi = {
  list: async (
    tenantId: string,
    params: TransparencyLogParams = {},
  ): Promise<TransparencyLogResponse> => {
    const { data } = await api.get<TransparencyLogResponse>(
      `/api/tenants/${tenantId}/transparency-logs`,
      { params },
    )
    return data
  },

  stats: async (tenantId: string): Promise<TransparencyStats> => {
    const { data } = await api.get<TransparencyStats>(
      `/api/tenants/${tenantId}/transparency-logs/stats`,
    )
    return data
  },

  exportCsv: async (
    tenantId: string,
    params: TransparencyLogParams = {},
  ): Promise<void> => {
    const response = await api.get(
      `/api/tenants/${tenantId}/transparency-logs/export`,
      { params, responseType: 'blob' },
    )
    const blob = new Blob([response.data as BlobPart], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'transparency-logs.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  },
}
