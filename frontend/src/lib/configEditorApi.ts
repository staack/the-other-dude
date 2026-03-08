/**
 * Config Editor API client -- TypeScript functions for browsing RouterOS
 * menu paths and executing commands on devices via the backend proxy.
 */

import { api } from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowseResponse {
  success: boolean
  entries: Record<string, string>[]
  error: string | null
  path: string
}

export interface CommandResponse {
  success: boolean
  data: Record<string, string>[]
  error: string | null
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const configEditorApi = {
  browse: (tenantId: string, deviceId: string, path: string) =>
    api
      .get<BrowseResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config-editor/browse`,
        { params: { path } },
      )
      .then((r) => r.data),

  addEntry: (
    tenantId: string,
    deviceId: string,
    path: string,
    properties: Record<string, string>,
  ) =>
    api
      .post<CommandResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config-editor/add`,
        { path, properties },
      )
      .then((r) => r.data),

  setEntry: (
    tenantId: string,
    deviceId: string,
    path: string,
    entryId: string | undefined,
    properties: Record<string, string>,
  ) =>
    api
      .post<CommandResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config-editor/set`,
        { path, entry_id: entryId ?? null, properties },
      )
      .then((r) => r.data),

  removeEntry: (tenantId: string, deviceId: string, path: string, entryId: string) =>
    api
      .post<CommandResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config-editor/remove`,
        { path, entry_id: entryId },
      )
      .then((r) => r.data),

  execute: (tenantId: string, deviceId: string, command: string) =>
    api
      .post<CommandResponse>(
        `/api/tenants/${tenantId}/devices/${deviceId}/config-editor/execute`,
        { command },
      )
      .then((r) => r.data),
}
