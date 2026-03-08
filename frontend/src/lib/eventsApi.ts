import { api } from './api'

export interface DashboardEvent {
  id: string
  event_type: 'alert' | 'status_change' | 'config_backup'
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  device_hostname: string | null
  device_id: string | null
  timestamp: string // ISO 8601
}

export interface EventsParams {
  limit?: number
  event_type?: 'alert' | 'status_change' | 'config_backup'
}

export const eventsApi = {
  getEvents: (tenantId: string, params?: EventsParams) =>
    api
      .get<DashboardEvent[]>(`/api/tenants/${tenantId}/events`, { params })
      .then((r) => r.data),
}
