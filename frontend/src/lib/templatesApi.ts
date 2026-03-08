/**
 * Templates API client -- TypeScript functions for config template CRUD,
 * preview, push orchestration, and push status polling.
 */

import { api } from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariableDef {
  name: string
  type: 'string' | 'ip' | 'integer' | 'boolean' | 'subnet'
  default: string | null
  description: string | null
}

export interface TemplateResponse {
  id: string
  name: string
  description: string | null
  content: string
  variables: VariableDef[]
  tags: string[]
  created_at: string
  updated_at: string
}

export interface TemplateSummary {
  id: string
  name: string
  description: string | null
  tags: string[]
  variable_count: number
  created_at: string
  updated_at: string
}

export interface PushJob {
  device_id: string
  hostname: string
  status: 'pending' | 'pushing' | 'committed' | 'reverted' | 'failed'
  error_message: string | null
  started_at: string | null
  completed_at: string | null
}

export interface PushStatus {
  rollout_id: string
  jobs: PushJob[]
}

export interface TemplateCreateData {
  name: string
  description?: string | null
  content: string
  variables: VariableDef[]
  tags: string[]
}

export interface PushStartResult {
  rollout_id: string
  jobs: Array<{ job_id: string; device_id: string; device_hostname: string }>
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const templatesApi = {
  list: (tenantId: string, tag?: string) =>
    api
      .get<TemplateSummary[]>(`/api/tenants/${tenantId}/templates`, {
        params: tag ? { tag } : undefined,
      })
      .then((r) => r.data),

  get: (tenantId: string, templateId: string) =>
    api
      .get<TemplateResponse>(`/api/tenants/${tenantId}/templates/${templateId}`)
      .then((r) => r.data),

  create: (tenantId: string, data: TemplateCreateData) =>
    api
      .post<TemplateResponse>(`/api/tenants/${tenantId}/templates`, data)
      .then((r) => r.data),

  update: (tenantId: string, templateId: string, data: TemplateCreateData) =>
    api
      .put<TemplateResponse>(`/api/tenants/${tenantId}/templates/${templateId}`, data)
      .then((r) => r.data),

  delete: (tenantId: string, templateId: string) =>
    api.delete(`/api/tenants/${tenantId}/templates/${templateId}`).then((r) => r.data),

  preview: (
    tenantId: string,
    templateId: string,
    deviceId: string,
    variables: Record<string, string>,
  ) =>
    api
      .post<{ rendered: string; device_hostname: string }>(
        `/api/tenants/${tenantId}/templates/${templateId}/preview`,
        { device_id: deviceId, variables },
      )
      .then((r) => r.data),

  push: (
    tenantId: string,
    templateId: string,
    deviceIds: string[],
    variables: Record<string, string>,
  ) =>
    api
      .post<PushStartResult>(
        `/api/tenants/${tenantId}/templates/${templateId}/push`,
        { device_ids: deviceIds, variables },
      )
      .then((r) => r.data),

  pushStatus: (tenantId: string, rolloutId: string) =>
    api
      .get<PushStatus>(`/api/tenants/${tenantId}/templates/push-status/${rolloutId}`)
      .then((r) => r.data),
}
