import { useState } from 'react'
import { AxiosError } from 'axios'
import { ShieldCheck, LockKeyhole, LogOut, KeyRound, Loader2 } from 'lucide-react'
import { Button, Input, Select } from '../../shared/components/ui'
import { notify } from '../../shared/store/notificationStore'
import { useSecurityStore, type IdleLockMinutes } from '../../shared/store/securityStore'
import { useAuthStore } from './store/authStore'
import { RecentSignIns } from './RecentSignIns'
import {
  changePassword,
  disableTotp,
  enableTotp,
  enrollTotp,
  logout,
  type TotpEnrollment,
} from './api/authApi'
import { describeInvalid, type PasswordChangeFields } from './lib/passwordChange'

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const m = err.response?.data?.message
    return Array.isArray(m) ? m.join(', ') : (m ?? fallback)
  }
  return fallback
}

/**
 * Security section for the Settings app: two-factor (TOTP) enrollment via QR
 * and a lock/sign-out control. Mounted inside the existing Settings module.
 */
export function SecuritySettings() {
  const totpEnabled = useAuthStore((s) => s.totpEnabled)
  const refresh = useAuthStore((s) => s.refresh)
  const idleLockMinutes = useSecurityStore((s) => s.idleLockMinutes)
  const setIdleLockMinutes = useSecurityStore((s) => s.setIdleLockMinutes)

  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [pw, setPw] = useState<PasswordChangeFields>({
    current: '',
    next: '',
    confirm: '',
    token: '',
  })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const pwInvalid = describeInvalid(pw, totpEnabled)

  async function submitPasswordChange() {
    if (pwInvalid || pwBusy) return
    setPwBusy(true)
    setPwError(null)
    try {
      await changePassword(pw.current, pw.next, totpEnabled ? pw.token : undefined)
      setPw({ current: '', next: '', confirm: '', token: '' })
      // Notified, not just cleared: the side effect reaches beyond this screen —
      // every other signed-in browser has just been signed out — and a form that
      // silently empties itself is indistinguishable from one that failed.
      notify({
        title: 'Password changed',
        body: 'Other signed-in sessions have been signed out. This one stays open.',
        level: 'info',
        appId: 'settings',
      })
    } catch (err) {
      const message = errMessage(err, 'Could not change the password')
      setPwError(message)
      notify({ title: 'Password not changed', body: message, level: 'error', appId: 'settings' })
    } finally {
      setPwBusy(false)
    }
  }

  async function startEnroll() {
    setBusy(true)
    setError(null)
    try {
      setEnrollment(await enrollTotp(password))
      setPassword('')
    } catch (err) {
      setError(errMessage(err, 'Could not start enrollment'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnroll() {
    setBusy(true)
    setError(null)
    try {
      await enableTotp(code)
      setEnrollment(null)
      setCode('')
      await refresh()
    } catch (err) {
      setError(errMessage(err, 'Invalid code'))
    } finally {
      setBusy(false)
    }
  }

  async function doDisable() {
    setBusy(true)
    setError(null)
    try {
      await disableTotp(password)
      setPassword('')
      await refresh()
    } catch (err) {
      setError(errMessage(err, 'Could not disable'))
    } finally {
      setBusy(false)
    }
  }

  async function doLogout() {
    await logout()
    await refresh()
  }

  return (
    <section className="border-outline-variant mb-10 border-t pt-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="bg-secondary/10 text-secondary p-2">
          <ShieldCheck size={20} />
        </div>
        <h2 className="font-ui text-on-surface text-xl font-semibold">Security</h2>
      </div>

      <div className="space-y-6">
        {/* Recent sign-ins — brief 84. First, because "has anyone been trying
            to get in?" is the question people open this section to answer. */}
        <RecentSignIns />

        {/* Two-factor authentication */}
        <div className="border-outline-variant bg-surface-container-low border p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-on-surface text-sm font-medium">Two-factor authentication</p>
              <p className="font-content text-on-surface-variant mt-0.5 text-[11px]">
                {totpEnabled
                  ? 'Enabled — a code from your authenticator app is required at login.'
                  : 'Add a time-based code (TOTP) required at every unlock.'}
              </p>
            </div>
            <span
              className={`font-ui px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                totpEnabled
                  ? 'bg-secondary/15 text-secondary'
                  : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {totpEnabled ? 'On' : 'Off'}
            </span>
          </div>

          {!totpEnabled && !enrollment && (
            <div className="space-y-3">
              <Input
                id="enroll-totp-password"
                label="Confirm password to enable"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button variant="primary" onClick={startEnroll} disabled={busy || !password}>
                <LockKeyhole size={14} /> Enable two-factor
              </Button>
            </div>
          )}

          {!totpEnabled && enrollment && (
            <div className="space-y-3">
              <p className="font-content text-on-surface-variant text-[12px]">
                Scan this with your authenticator app, then enter the 6-digit code to confirm.
              </p>
              <img
                src={enrollment.qrDataUrl}
                alt="TOTP QR code"
                className="border-outline-variant border"
                width={160}
                height={160}
              />
              <p className="font-content text-on-surface-variant text-[11px] break-all">
                Or enter this secret manually:{' '}
                <span className="font-mono">{enrollment.secret}</span>
              </p>
              <Input
                id="totp-confirm"
                label="Code from app"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="primary" onClick={confirmEnroll} disabled={busy || !code}>
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEnrollment(null)
                    setCode('')
                    setError(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {totpEnabled && (
            <div className="space-y-3">
              <Input
                id="disable-totp-password"
                label="Confirm password to disable"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button variant="destructive" onClick={doDisable} disabled={busy || !password}>
                Disable two-factor
              </Button>
            </div>
          )}

          {error && <p className="font-content text-error mt-2 text-[11px]">{error}</p>}
        </div>

        {/* Change password */}
        <div className="border-outline-variant bg-surface-container-low border p-4">
          <div className="mb-3">
            <p className="text-on-surface flex items-center gap-2 text-sm font-medium">
              <KeyRound size={14} /> Change password
            </p>
            <p className="font-content text-on-surface-variant mt-0.5 text-[11px]">
              At least 10 characters. Changing it signs out every other session; this one stays
              open.
            </p>
          </div>

          <div className="space-y-3">
            <Input
              id="change-password-current"
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
            />
            <Input
              id="change-password-new"
              label="New password"
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
            />
            <Input
              id="change-password-confirm"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
            />
            {totpEnabled && (
              <Input
                id="change-password-totp"
                label="Code from your authenticator app"
                inputMode="numeric"
                placeholder="123456"
                value={pw.token}
                onChange={(e) => setPw((p) => ({ ...p, token: e.target.value }))}
              />
            )}

            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={() => void submitPasswordChange()}
                disabled={!!pwInvalid || pwBusy}
              >
                {pwBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                Change password
              </Button>
              {/* The reason the button is disabled, said out loud. A greyed-out
                  control with no explanation is the thing this avoids. */}
              {pwInvalid && (
                <span className="font-content text-on-surface-variant text-[11px]">
                  {pwInvalid}
                </span>
              )}
            </div>

            {pwError && <p className="font-content text-error text-[11px]">{pwError}</p>}

            {/* Stated plainly rather than implied. There is deliberately no recovery
                flow: with one local account, any reset path is a back door. */}
            <p className="border-outline-variant font-content text-on-surface-variant border-t pt-3 text-[11px]">
              There is no password recovery. If you lose this password the only way back in is to
              delete the data volume, which erases the account and its files — so keep a backup.
            </p>
          </div>
        </div>

        {/* Auto-lock after idle (brief 97) */}
        <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-4 border p-4">
          <div>
            <p className="text-on-surface text-sm font-medium">Auto-lock</p>
            <p className="font-content text-on-surface-variant mt-0.5 text-[11px]">
              Return to the lock screen after a period with no activity. A playing video or audio
              track holds the lock.
            </p>
          </div>
          <Select
            aria-label="Auto-lock after"
            className="w-40"
            value={String(idleLockMinutes)}
            onValueChange={(v) => setIdleLockMinutes(Number(v) as IdleLockMinutes)}
            options={[
              { value: '0', label: 'Never' },
              { value: '5', label: 'After 5 minutes' },
              { value: '15', label: 'After 15 minutes' },
              { value: '30', label: 'After 30 minutes' },
            ]}
          />
        </div>

        {/* Session */}
        <div className="border-outline-variant bg-surface-container-low flex items-center justify-between border p-4">
          <div>
            <p className="text-on-surface text-sm font-medium">Lock this computer</p>
            <p className="font-content text-on-surface-variant mt-0.5 text-[11px]">
              End your session and return to the lock screen.
            </p>
          </div>
          <Button variant="default" onClick={doLogout}>
            <LogOut size={14} /> Lock
          </Button>
        </div>
      </div>
    </section>
  )
}
