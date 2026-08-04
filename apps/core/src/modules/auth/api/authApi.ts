import { api } from '../../../lib/axios'

export interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
  totpEnabled: boolean
  /** True when the operator set SETUP_TOKEN and the box is still unclaimed. */
  setupTokenRequired: boolean
}

export interface TotpEnrollment {
  secret: string
  uri: string
  qrDataUrl: string
}

export async function getStatus(): Promise<AuthStatus> {
  const res = await api.get<AuthStatus>('/auth/status')
  return res.data
}

export async function setupPassword(password: string, token?: string): Promise<void> {
  await api.post('/auth/setup', { password, ...(token ? { token } : {}) })
}

export async function login(password: string, token?: string): Promise<void> {
  await api.post('/auth/login', { password, ...(token ? { token } : {}) })
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

export async function enrollTotp(password: string): Promise<TotpEnrollment> {
  const res = await api.post<TotpEnrollment>('/auth/totp/enroll', { password })
  return res.data
}

export async function enableTotp(token: string): Promise<void> {
  await api.post('/auth/totp/enable', { token })
}

export async function disableTotp(password: string): Promise<void> {
  await api.post('/auth/totp/disable', { password })
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  token?: string
): Promise<void> {
  await api.post('/auth/password', {
    currentPassword,
    newPassword,
    ...(token ? { token } : {}),
  })
}
