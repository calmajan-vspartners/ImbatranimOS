import rehypeHighlight from 'rehype-highlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { Options } from 'react-markdown'
import './highlight.css'

/**
 * Syntax highlighting for fenced code blocks — loaded on demand, and only for a
 * hand-picked set of languages.
 *
 * ## Why this module exists separately
 *
 * It is dynamically imported by the preview the first time a document contains a fence,
 * so a document without code costs nothing at all. Measured against the production build:
 * the editor's own chunk is 11.1 kB gzipped, this one is 53.7 kB (plus 0.3 kB of CSS), and
 * the loader that pulls it in costs 0.26 kB. Worth paying when there is code on the screen;
 * not worth paying to read a shopping list.
 *
 * ## Why a subset rather than lowlight's `common`
 *
 * `common` is 37 grammars. These 16 are the ones a document written *on this machine*
 * plausibly contains — its own shell, config, and source languages. Anything else falls
 * back to unhighlighted monospace, which is what the app did for every language before.
 *
 * Measured, so the trade is on the record rather than assumed: dropping eight of these
 * grammars shrank the chunk by 0.19 kB gzipped. Effectively all of the weight is
 * highlight.js's own engine, so a shorter list buys nothing — which is also why extending
 * the list later is close to free, and why switching to all 37 would not be.
 *
 * `detect: false` for the same reason auto-detection is off in most editors: guessing the
 * language of a three-line snippet is unreliable, and a wrong guess highlights the wrong
 * tokens rather than none.
 */
/**
 * Spelled through react-markdown's own option type rather than importing `PluggableList`
 * from `unified`: unified is only a transitive dependency here, and a package should not
 * type its exports against something it does not declare.
 */
export type RehypePlugins = NonNullable<Options['rehypePlugins']>

export const HIGHLIGHT_PLUGINS: RehypePlugins = [
  [
    rehypeHighlight,
    {
      detect: false,
      languages: {
        bash,
        c,
        css,
        diff,
        dockerfile,
        go,
        ini,
        javascript,
        json,
        markdown,
        python,
        rust,
        sql,
        typescript,
        xml,
        yaml,
      },
    },
  ],
]

/** Does this document contain a fenced code block worth loading the highlighter for? */
export function hasFencedCode(text: string): boolean {
  return /^ {0,3}(```|~~~)/m.test(text)
}
