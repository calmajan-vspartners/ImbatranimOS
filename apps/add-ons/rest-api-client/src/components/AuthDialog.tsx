import { useState } from 'react'
import { Button, Dialog, Input, Select } from '@imbatranim/ui'
import type { Environment } from '../types'
import { basicHeader, bearerHeader, looksSecret, toVariables } from '../lib/environments'

/**
 * The auth helper — writes the `Authorization` header so nobody has to remember
 * whether it is `Bearer ` with a space or how Basic is encoded.
 *
 * Bearer writes a **`{{variable}}` reference**, not the token: that is the point of
 * having it here rather than typing the header by hand. The saved request then holds
 * `Bearer {{apiToken}}`, which is correct in every environment and safe to export.
 */
export function AuthDialog({
  environment,
  onApply,
  onClose,
}: {
  environment: Environment | null
  onApply: (header: { name: string; value: string }) => void
  onClose: () => void
}) {
  const varNames = Object.keys(toVariables(environment))
  const [kind, setKind] = useState<'bearer' | 'basic'>('bearer')
  // Default to a token-looking variable, not simply the first one. Picking
  // `varNames[0]` produced `Bearer {{base}}` — a header built from the base URL,
  // which is wrong in a way that still looks plausible in the field.
  const [varName, setVarName] = useState(varNames.find(looksSecret) ?? varNames[0] ?? 'token')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const apply = () => {
    if (kind === 'bearer') {
      const name = varName.trim()
      if (name === '') {
        setError('Name the variable that holds the token.')
        return
      }
      onApply(bearerHeader(name))
      onClose()
      return
    }
    const result = basicHeader(user, password)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onApply(result)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Authorization">
      <div className="flex w-[26rem] max-w-full flex-col gap-2">
        <Select
          label="Type"
          options={[
            { value: 'bearer', label: 'Bearer token' },
            { value: 'basic', label: 'Basic (username + password)' },
          ]}
          value={kind}
          onValueChange={(v) => {
            setKind(v === 'basic' ? 'basic' : 'bearer')
            setError(null)
          }}
        />

        {kind === 'bearer' ? (
          <>
            {varNames.length > 0 ? (
              <Select
                label="Token variable"
                options={varNames.map((n) => ({ value: n, label: n }))}
                value={
                  varNames.includes(varName) ? varName : (varNames.find(looksSecret) ?? varNames[0])
                }
                onValueChange={(v) => setVarName(String(v))}
              />
            ) : (
              <Input
                label="Token variable"
                placeholder="apiToken"
                value={varName}
                onChange={(e) => setVarName(e.target.value)}
              />
            )}
            <p className="text-on-surface-variant text-[11px]">
              Adds{' '}
              <code className="font-mono">Authorization: Bearer {`{{${varName || 'token'}}}`}</code>
              . The token itself stays in the environment, so the saved request is safe to share.
            </p>
          </>
        ) : (
          <>
            <Input label="Username" value={user} onChange={(e) => setUser(e.target.value)} />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-on-surface-variant text-[11px]">
              Basic has to be base64-encoded, so the encoded value is written into the header
              directly — it cannot reference a variable.
            </p>
          </>
        )}

        {error && <p className="text-error text-[12px]">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="default" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={apply}>
            Add header
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
