/**
 * Certificates API client -- TypeScript functions for the Internal Certificate
 * Authority: CA lifecycle, device cert signing, deployment, rotation, and revocation.
 * Uses the shared axios instance from api.ts.
 */

import { api } from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CAResponse {
  id: string
  tenant_id: string
  common_name: string
  fingerprint_sha256: string
  serial_number: string
  not_valid_before: string
  not_valid_after: string
  created_at: string
}

export interface DeviceCertResponse {
  id: string
  tenant_id: string
  device_id: string
  ca_id: string
  common_name: string
  fingerprint_sha256: string
  serial_number: string
  not_valid_before: string
  not_valid_after: string
  status:
    | 'issued'
    | 'deploying'
    | 'deployed'
    | 'expiring'
    | 'expired'
    | 'revoked'
    | 'superseded'
  deployed_at: string | null
  created_at: string
  updated_at: string
}

export interface CertDeployResponse {
  success: boolean
  device_id: string
  cert_name_on_device?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build query params object, including tenant_id when provided. */
function tenantParams(
  tenantId?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = {}
  if (tenantId) params.tenant_id = tenantId
  if (extra) Object.assign(params, extra)
  return params
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const certificatesApi = {
  /** Get the tenant's CA (returns null if no CA exists). */
  getCA: async (tenantId?: string): Promise<CAResponse | null> => {
    try {
      const { data } = await api.get<CAResponse>('/api/certificates/ca', {
        params: tenantParams(tenantId),
      })
      return data
    } catch (err: any) {
      if (err?.response?.status === 404) return null
      throw err
    }
  },

  /** Initialize a new CA for the tenant. */
  createCA: (
    commonName?: string,
    validityYears?: number,
    tenantId?: string,
  ) =>
    api
      .post<CAResponse>(
        '/api/certificates/ca',
        {
          common_name: commonName ?? 'Portal Root CA',
          validity_years: validityYears ?? 10,
        },
        { params: tenantParams(tenantId) },
      )
      .then((r) => r.data),

  /** Download the CA certificate in PEM format. */
  getCACertPEM: (tenantId?: string) =>
    api
      .get<string>('/api/certificates/ca/pem', {
        responseType: 'text',
        params: tenantParams(tenantId),
      })
      .then((r) => r.data),

  /** Sign a certificate for a specific device. */
  signCert: (deviceId: string, validityDays?: number, tenantId?: string) =>
    api
      .post<DeviceCertResponse>(
        '/api/certificates/sign',
        {
          device_id: deviceId,
          validity_days: validityDays ?? 730,
        },
        { params: tenantParams(tenantId) },
      )
      .then((r) => r.data),

  /** Deploy an already-signed certificate to its device. */
  deployCert: (certId: string, tenantId?: string) =>
    api
      .post<CertDeployResponse>(
        `/api/certificates/${certId}/deploy`,
        undefined,
        { params: tenantParams(tenantId) },
      )
      .then((r) => r.data),

  /** Bulk deploy certificates (sign + deploy) to multiple devices. */
  bulkDeploy: (deviceIds: string[], tenantId?: string) =>
    api
      .post<CertDeployResponse[]>(
        '/api/certificates/deploy/bulk',
        { device_ids: deviceIds },
        { params: tenantParams(tenantId) },
      )
      .then((r) => r.data),

  /** List device certificates (optionally filtered by device). */
  getDeviceCerts: (deviceId?: string, tenantId?: string) =>
    api
      .get<DeviceCertResponse[]>('/api/certificates/devices', {
        params: tenantParams(
          tenantId,
          deviceId ? { device_id: deviceId } : undefined,
        ),
      })
      .then((r) => r.data),

  /** Rotate a deployed certificate (supersede old, sign + deploy new). */
  rotateCert: (certId: string, tenantId?: string) =>
    api
      .post<CertDeployResponse>(
        `/api/certificates/${certId}/rotate`,
        undefined,
        { params: tenantParams(tenantId) },
      )
      .then((r) => r.data),

  /** Revoke a certificate. */
  revokeCert: (certId: string, tenantId?: string) =>
    api
      .post<DeviceCertResponse>(
        `/api/certificates/${certId}/revoke`,
        undefined,
        { params: tenantParams(tenantId) },
      )
      .then((r) => r.data),
}
