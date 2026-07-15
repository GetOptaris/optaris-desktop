import CodeMirror, { EditorView, type BasicSetupOptions } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { githubDarkInit, githubLightInit } from '@uiw/codemirror-theme-github'
import { useTheme } from 'next-themes'

/** Blend the editor into the surrounding `bg-muted` panel and match the app's `text-xs` code size. */
const themeSettings = {
  background: 'transparent',
  gutterBackground: 'transparent',
  fontSize: '12px'
} as const

const lightTheme = githubLightInit({ settings: themeSettings })
const darkTheme = githubDarkInit({ settings: themeSettings })

// Module-level so their identity is stable across renders (a new array would force a reconfigure).
const jsonExtensions = [json(), EditorView.lineWrapping]
const textExtensions = [EditorView.lineWrapping]

/** A viewer, not an editor: line numbers + folding, no active-line highlight or autocompletion. */
const readOnlySetup: BasicSetupOptions = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false
}

/**
 * Read-only CodeMirror viewer for request/response bodies. `json` mode gives syntax
 * highlighting + folding; `text` mode (SSE streams, truncated non-JSON) is plain text but
 * keeps search/scroll/wrap. Theme follows the app's light/dark preference. Height is capped
 * at 20rem (matching the old `<pre>`), overflowing to an internal scroll.
 */
export function JsonView({
  value,
  language = 'json'
}: {
  value: string
  language?: 'json' | 'text'
}): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  return (
    <CodeMirror
      value={value}
      readOnly
      theme={resolvedTheme === 'dark' ? darkTheme : lightTheme}
      extensions={language === 'json' ? jsonExtensions : textExtensions}
      basicSetup={readOnlySetup}
      maxHeight="20rem"
    />
  )
}
