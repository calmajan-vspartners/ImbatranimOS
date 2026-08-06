import { ScrollArea, cn } from '@imbatranim/ui'
import { useMemo, useState } from 'react'
import type { ProxyResponse } from '../types'
import { base64ToBytes, base64ToText, formatBytes, prettyBody } from '../lib/body'
import { statusToken } from '../lib/ui'

type ResponseTab = 'body' | 'headers'

interface ResponseViewerProps {
  response: ProxyResponse | null
  error: string | null
  loading: boolean
}

export function ResponseViewer({ response, error, loading }: ResponseViewerProps) {
  const [tab, setTab] = useState<ResponseTab>('body')

  const decoded = useMemo(() => {
    if (!response) return { text: '', size: 0 }
    return {
      text: prettyBody(base64ToText(response.bodyBase64), response.headers['content-type']),
      size: base64ToBytes(response.bodyBase64).byteLength,
    }
  }, [response])

  if (loading) {
    return (
      <div className="text-on-surface-variant font-ui flex flex-1 items-center justify-center text-[12px]">
        Sending request…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-error max-w-full font-mono text-[12px] break-words">{error}</p>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="text-on-surface-variant font-ui flex flex-1 items-center justify-center text-[12px]">
        Send a request to see the response
      </div>
    )
  }

  const headerEntries = Object.entries(response.headers)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Status line */}
      <div className="border-outline-variant flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5 text-[12px]">
        <span className={cn('font-ui font-semibold', statusToken(response.status))}>
          {response.status} {response.statusText}
        </span>
        <span className="text-on-surface-variant font-ui">{response.elapsedMs} ms</span>
        <span className="text-on-surface-variant font-ui">{formatBytes(decoded.size)}</span>
        {response.truncated && (
          <span className="text-error font-ui font-semibold" title="Body exceeded the 10 MB cap">
            truncated
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="border-outline-variant flex gap-0 border-b">
        <ResTab active={tab === 'body'} onClick={() => setTab('body')}>
          Body
        </ResTab>
        <ResTab active={tab === 'headers'} onClick={() => setTab('headers')}>
          Headers ({headerEntries.length})
        </ResTab>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {tab === 'body' ? (
          <pre className="text-on-surface p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
            {decoded.text || <span className="text-on-surface-variant">(empty body)</span>}
          </pre>
        ) : (
          <div className="flex flex-col p-2">
            {headerEntries.map(([k, v]) => (
              <div key={k} className="flex gap-2 px-1 py-0.5 text-[12px]">
                <span className="text-secondary shrink-0 font-mono">{k}:</span>
                <span className="text-on-surface font-mono break-all">{v}</span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function ResTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-ui -mb-px cursor-pointer border-b-2 px-3 py-1.5 text-[12px] outline-none',
        active
          ? 'border-primary text-primary'
          : 'text-on-surface-variant hover:text-on-surface border-transparent'
      )}
    >
      {children}
    </button>
  )
}
