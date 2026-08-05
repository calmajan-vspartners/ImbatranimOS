import {
  createElement,
  useEffect,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { ImageOff } from 'lucide-react'
import Markdown, {
  defaultUrlTransform,
  type Components,
  type ExtraProps,
  type UrlTransform,
} from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, downloadUrl } from '@imbatranim/core'
import { resolveRelative } from '../lib/assetPaths'
import { hasFencedCode, type RehypePlugins } from '../lib/highlight'
import type { Heading } from '../lib/outline'

/**
 * The rendered half of the editor.
 *
 * Three things happen here that a bare `<Markdown>` does not do, and all three were
 * discovered by rendering a real README rather than a sample document:
 *
 * 1. **Every block carries its source line** (`data-src-line`). That is what makes
 *    scroll sync possible at all — see `lib/scrollSync.ts` for why a proportional
 *    ratio is not good enough.
 * 2. **Relative image links resolve against the filesystem.** Before this, `![](
 *    docs/shot.png)` asked the *web origin* for `docs/shot.png` and drew a broken
 *    image — in an OS whose whole point is that the files are real.
 * 3. **Links do not navigate the desktop away.** An `<a href>` inside the preview is
 *    a live link in the single-page app that hosts the entire OS; clicking one used to
 *    replace the desktop, unsaved buffer and all.
 *
 * Still deliberately absent: `rehype-raw`. A markdown file is untrusted input — it can
 * arrive by upload, git clone, or `curl` in the terminal — so raw HTML stays inert
 * text. `MarkdownPreview.test.tsx` asserts it, because "we just don't pass the plugin"
 * is exactly the kind of property a later refactor removes by accident.
 */

/** What react-markdown hands a replacement component, in the shape used here. */
type StampProps = ExtraProps & { children?: ReactNode }

/** The mdast/hast source line of a rendered node, when it has one. */
function lineOf(props: ExtraProps): number | undefined {
  return props.node?.position?.start.line
}

/**
 * A pass-through renderer for `tag` that records the source line it came from.
 *
 * `node` is stripped rather than spread: it is react-markdown's own metadata, and React
 * would warn about an unknown DOM attribute.
 *
 * `tag` is a plain string and the result is a component over the props this factory
 * actually reads. Typing it as `Components[T]` instead makes TypeScript build the union of
 * every intrinsic element's props and give up ("union type too complex"), for no gain: the
 * body touches nothing tag-specific, and assignment into `Components` is still checked.
 */
function stamped(tag: string): ComponentType<StampProps> {
  const Stamped = ({ node, children, ...rest }: StampProps) =>
    createElement(tag, { ...rest, 'data-src-line': lineOf({ node }) }, children)
  return Stamped
}

/** Anchor-linkable heading, so a document's own table of contents works. */
function heading(tag: string, slugs: Map<number, string>): ComponentType<StampProps> {
  const Heading = ({ node, children, ...rest }: StampProps) => {
    const line = lineOf({ node })
    return createElement(
      tag,
      { ...rest, id: line === undefined ? undefined : slugs.get(line), 'data-src-line': line },
      children
    )
  }
  return Heading
}

/**
 * react-markdown strips every URL scheme it does not recognise, and `data:` is one of
 * them — which is why an inline base64 image silently rendered as nothing at all.
 *
 * That default is right for links and too strict for images: generated markdown embeds
 * `data:image/…` routinely, the desktop's CSP already allows `img-src data:`, and an SVG
 * loaded through `<img>` cannot run script. So `data:image/*` is allowed on an image
 * `src` and nowhere else — `data:text/html` in an `href` stays stripped, which the
 * tests pin down.
 */
const urlTransform: UrlTransform = (url, key, node) => {
  if (key === 'src' && node.tagName === 'img' && /^data:image\/[a-z0-9+.-]+[;,]/i.test(url)) {
    return url
  }
  return defaultUrlTransform(url)
}

export function MarkdownPreview({
  text,
  root,
  docDir,
  headings,
  onToggleTaskLine,
  onOpenRelative,
  className,
}: {
  text: string
  /** Filesystem root of the open document, for resolving relative links. */
  root: string
  /** Directory of the open document, for resolving relative links. */
  docDir: string
  headings: Heading[]
  /** Clicking a task checkbox edits the source line it came from. */
  onToggleTaskLine: (line: number) => void
  /** A relative link the preview cannot render itself was clicked. */
  onOpenRelative: (path: string) => void
  className?: string
}) {
  const slugs = new Map(headings.map((h) => [h.line, h.slug]))

  /**
   * Syntax highlighting arrives only once the document turns out to contain code, and
   * never again after that.
   *
   * A dynamic import is what keeps it honest: a document with no fence never downloads a
   * single grammar. Loaded as an inline async IIFE inside the effect, which is the shape
   * `react-hooks/set-state-in-effect` accepts for genuinely asynchronous work (the same
   * pattern `StorageSettings` and `AboutMachine` use).
   */
  const [highlightPlugins, setHighlightPlugins] = useState<RehypePlugins | null>(null)
  const wantsHighlight = hasFencedCode(text)
  useEffect(() => {
    if (!wantsHighlight || highlightPlugins) return
    let alive = true
    void (async () => {
      try {
        const mod = await import('../lib/highlight')
        if (alive) setHighlightPlugins(mod.HIGHLIGHT_PLUGINS)
      } catch (err) {
        // Unhighlighted monospace is what this app shipped for its whole life; a failed
        // chunk load should not take the preview with it.
        console.error('[markdown-editor] failed to load the highlighter', err)
      }
    })()
    return () => {
      alive = false
    }
  }, [wantsHighlight, highlightPlugins])

  const components: Components = {
    h1: heading('h1', slugs),
    h2: heading('h2', slugs),
    h3: heading('h3', slugs),
    h4: heading('h4', slugs),
    h5: heading('h5', slugs),
    h6: heading('h6', slugs),
    p: stamped('p'),
    ul: stamped('ul'),
    ol: stamped('ol'),
    blockquote: stamped('blockquote'),
    pre: stamped('pre'),
    table: stamped('table'),
    hr: stamped('hr'),

    // A list item is where a task checkbox lives, and — unlike the checkbox itself —
    // it carries a source position, so it is the element that knows which line to edit.
    li: ({ node, children, ...rest }) => {
      const line = lineOf({ node })
      return (
        <li
          {...rest}
          data-src-line={line}
          onClick={(event: MouseEvent<HTMLLIElement>) => {
            const target = event.target as HTMLElement
            if (target.tagName !== 'INPUT' || line === undefined) return
            onToggleTaskLine(line)
          }}
        >
          {children}
        </li>
      )
    },

    /**
     * remark-gfm renders task checkboxes `disabled`, which is honest for a static
     * preview and useless in an editor: ticking a box is the single most common edit
     * anyone makes to a markdown checklist. Read-only (not disabled) keeps the state
     * owned by the source text while still delivering the click to the `li` above.
     */
    input: ({ node: _node, type, checked, disabled, ...rest }) =>
      type === 'checkbox' ? (
        <input
          {...rest}
          type="checkbox"
          checked={Boolean(checked)}
          readOnly
          className="cursor-pointer"
          aria-label={checked ? 'Task done — click to clear' : 'Task not done — click to complete'}
        />
      ) : (
        <input {...rest} type={type} disabled={disabled} />
      ),

    img: ({ node, src, alt, ...rest }) => {
      const line = lineOf({ node })
      const raw = typeof src === 'string' ? src : ''
      const resolved = resolveRelative(docDir, raw)
      if (resolved) {
        return (
          <img {...rest} src={downloadUrl(root, resolved)} alt={alt ?? ''} data-src-line={line} />
        )
      }
      if (raw.startsWith('data:')) {
        return <img {...rest} src={raw} alt={alt ?? ''} data-src-line={line} />
      }
      // Remote images are refused by the desktop's `img-src 'self' data: blob:` policy,
      // so the browser would draw a broken-image icon with no explanation. Saying why
      // — and keeping the URL reachable — beats a mystery.
      return (
        <span
          data-src-line={line}
          data-external-image={raw || 'empty'}
          className="border-outline-variant bg-surface-container font-ui text-on-surface-variant inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-[10px]"
        >
          <ImageOff size={11} />
          <span className="truncate">{alt || 'image'} — external image blocked by policy</span>
          {raw && !raw.startsWith('#') && (
            <a href={raw} target="_blank" rel="noopener noreferrer" className="underline">
              open
            </a>
          )}
        </span>
      )
    },

    a: ({ node, href, children, ...rest }) => {
      const line = lineOf({ node })
      const target = typeof href === 'string' ? href : ''

      // In-document anchors: handled here because the preview scrolls inside its own
      // container, which the browser's default hash jump does not scroll.
      if (target.startsWith('#')) {
        return (
          <a
            {...rest}
            href={target}
            data-src-line={line}
            onClick={(event) => {
              event.preventDefault()
              const container = event.currentTarget.closest('.md-preview')
              container
                ?.querySelector(`#${CSS.escape(target.slice(1))}`)
                ?.scrollIntoView({ block: 'start' })
            }}
          >
            {children}
          </a>
        )
      }

      const resolved = resolveRelative(docDir, target)
      if (resolved) {
        return (
          <a
            {...rest}
            href={downloadUrl(root, resolved)}
            data-src-line={line}
            onClick={(event) => {
              event.preventDefault()
              onOpenRelative(resolved)
            }}
          >
            {children}
          </a>
        )
      }

      // Everything else leaves the desktop, so it leaves in a new tab. `noopener` is
      // not optional: this page holds an authenticated session.
      return (
        <a {...rest} href={target} data-src-line={line} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
  }

  return (
    <div
      className={cn(
        'md-preview',
        'prose prose-sm max-w-none p-6',
        'prose-headings:font-ui prose-headings:text-on-surface',
        'prose-p:text-on-surface prose-li:text-on-surface',
        'prose-strong:text-on-surface prose-blockquote:text-on-surface-variant',
        'prose-a:text-primary prose-code:text-on-surface',
        'prose-hr:border-outline-variant prose-blockquote:border-outline-variant',
        'prose-th:text-on-surface prose-td:text-on-surface-variant',
        'prose-pre:bg-surface-container prose-code:bg-surface-container',
        'prose-img:max-w-full',
        className
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlightPlugins ?? undefined}
        components={components}
        urlTransform={urlTransform}
      >
        {text}
      </Markdown>
    </div>
  )
}
