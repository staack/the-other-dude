/**
 * Alerts API client — TypeScript functions for alert rules, notification channels,
 * and alert events. Uses the shared axios instance from api.ts.
 */

import { api } from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertRule {
  id: string
  tenant_id: string
  device_id: string | null
  group_id: string | null
  name: string
  metric: string
  operator: string
  threshold: number
  duration_polls: number
  severity: 'critical' | 'warning' | 'info'
  enabled: boolean
  is_default: boolean
  channel_ids: string[]
  created_at: string
}

export interface NotificationChannel {
  id: string
  tenant_id: string
  name: string
  channel_type: 'email' | 'webhook' | 'slack'
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_user?: string | null
  smtp_use_tls?: boolean
  from_address?: string | null
  to_address?: string | null
  webhook_url?: string | null
  slack_webhook_url?: string | null
  created_at: string
}

export interface AlertEvent {
  id: string
  rule_id: string | null
  device_id: string
  tenant_id: string
  status: 'firing' | 'resolved' | 'flapping'
  severity: string
  metric: string | null
  value: number | null
  threshold: number | null
  message: string | null
  is_flapping: boolean
  acknowledged_at: string | null
  silenced_until: string | null
  fired_at: string
  resolved_at: string | null
  device_hostname?: string
  rule_name?: string
}

export interface AlertsListResponse {
  items: AlertEvent[]
  total: number
  page: number
  per_page: number
}

export interface AlertRuleCreateData {
  name: string
  metric: string
  operator: string
  threshold: number
  duration_polls?: number
  severity?: string
  device_id?: string | null
  group_id?: string | null
  channel_ids?: string[]
  enabled?: boolean
}

export interface ChannelCreateData {
  name: string
  channel_type: 'email' | 'webhook' | 'slack'
  smtp_host?: string
  smtp_port?: number
  smtp_user?: string
  smtp_password?: string
  smtp_use_tls?: boolean
  from_address?: string
  to_address?: string
  webhook_url?: string
  slack_webhook_url?: string
}

export interface AlertsFilterParams {
  status?: string
  severity?: string
  device_id?: string
  rule_id?: string
  start_date?: string
  end_date?: string
  page?: number
  per_page?: number
}

// ---------------------------------------------------------------------------
// Alert Rules
// ---------------------------------------------------------------------------

export const alertsApi = {
  // -- Alert Rules --

  getAlertRules: (tenantId: string, params?: { enabled?: boolean; metric?: string }) =>
    api
      .get<AlertRule[]>(`/api/tenants/${tenantId}/alert-rules`, { params })
      .then((r) => r.data),

  createAlertRule: (tenantId: string, data: AlertRuleCreateData) =>
    api
      .post<AlertRule>(`/api/tenants/${tenantId}/alert-rules`, data)
      .then((r) => r.data),

  updateAlertRule: (tenantId: string, ruleId: string, data: AlertRuleCreateData) =>
    api
      .put<AlertRule>(`/api/tenants/${tenantId}/alert-rules/${ruleId}`, data)
      .then((r) => r.data),

  deleteAlertRule: (tenantId: string, ruleId: string) =>
    api.delete(`/api/tenants/${tenantId}/alert-rules/${ruleId}`).then((r) => r.data),

  toggleAlertRule: (tenantId: string, ruleId: string) =>
    api
      .patch<{ id: string; enabled: boolean }>(
        `/api/tenants/${tenantId}/alert-rules/${ruleId}/toggle`,
      )
      .then((r) => r.data),

  // -- Notification Channels --

  getNotificationChannels: (tenantId: string) =>
    api
      .get<NotificationChannel[]>(`/api/tenants/${tenantId}/notification-channels`)
      .then((r) => r.data),

  createChannel: (tenantId: string, data: ChannelCreateData) =>
    api
      .post<NotificationChannel>(`/api/tenants/${tenantId}/notification-channels`, data)
      .then((r) => r.data),

  updateChannel: (tenantId: string, channelId: string, data: ChannelCreateData) =>
    api
      .put<NotificationChannel>(
        `/api/tenants/${tenantId}/notification-channels/${channelId}`,
        data,
      )
      .then((r) => r.data),

  deleteChannel: (tenantId: string, channelId: string) =>
    api
      .delete(`/api/tenants/${tenantId}/notification-channels/${channelId}`)
      .then((r) => r.data),

  testChannel: (tenantId: string, channelId: string) =>
    api
      .post<{ status: string; message: string }>(
        `/api/tenants/${tenantId}/notification-channels/${channelId}/test`,
      )
      .then((r) => r.data),

  testSmtp: (
    tenantId: string,
    data: {
      smtp_host: string
      smtp_port: number
      smtp_user?: string
      smtp_password?: string
      smtp_use_tls: boolean
      from_address: string
      to_address: string
    },
  ) =>
    api
      .post<{ success: boolean; message: string }>(
        `/api/tenants/${tenantId}/notification-channels/test-smtp`,
        data,
      )
      .then((r) => r.data),

  // -- Alert Events --

  getAlerts: (tenantId: string, params?: AlertsFilterParams) =>
    api
      .get<AlertsListResponse>(`/api/tenants/${tenantId}/alerts`, { params })
      .then((r) => r.data),

  getActiveAlertCount: (tenantId: string) =>
    api
      .get<{ count: number }>(`/api/tenants/${tenantId}/alerts/active-count`)
      .then((r) => r.data),

  acknowledgeAlert: (tenantId: string, alertId: string) =>
    api
      .post<{ status: string; message: string }>(
        `/api/tenants/${tenantId}/alerts/${alertId}/acknowledge`,
      )
      .then((r) => r.data),

  silenceAlert: (tenantId: string, alertId: string, durationMinutes: number) =>
    api
      .post<{ status: string; message: string }>(
        `/api/tenants/${tenantId}/alerts/${alertId}/silence`,
        { duration_minutes: durationMinutes },
      )
      .then((r) => r.data),

  getDeviceAlerts: (tenantId: string, deviceId: string, params?: AlertsFilterParams) =>
    api
      .get<AlertsListResponse>(`/api/tenants/${tenantId}/devices/${deviceId}/alerts`, {
        params,
      })
      .then((r) => r.data),
}
