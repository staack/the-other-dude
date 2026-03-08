import { api } from './api'

export interface SMTPSettings {
  smtp_host: string
  smtp_port: number
  smtp_user: string
  smtp_use_tls: boolean
  smtp_from_address: string
  smtp_provider: string
  smtp_password_set: boolean
  source: 'database' | 'environment'
}

export async function getSMTPSettings(): Promise<SMTPSettings> {
  const res = await api.get('/api/settings/smtp')
  return res.data
}

export async function updateSMTPSettings(data: {
  smtp_host: string
  smtp_port: number
  smtp_user?: string
  smtp_password?: string
  smtp_use_tls: boolean
  smtp_from_address: string
  smtp_provider: string
}): Promise<void> {
  await api.put('/api/settings/smtp', data)
}

export async function testSMTPSettings(data: {
  to: string
  smtp_host?: string
  smtp_port?: number
  smtp_user?: string
  smtp_password?: string
  smtp_use_tls?: boolean
  smtp_from_address?: string
}): Promise<{ success: boolean; message: string }> {
  const res = await api.post('/api/settings/smtp/test', data)
  return res.data
}
