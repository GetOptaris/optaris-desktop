/* eslint-disable react-refresh/only-export-components -- provider + hooks are colocated by design; HMR isn't relevant for this i18n infra module. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './en'
import zh from './zh'

export type Lang = 'zh' | 'en'
/** What the user picked; `system` resolves from the OS/browser language at runtime. */
export type LangPreference = 'system' | Lang

const STORAGE_KEY = 'optaris.locale'
const DICTS: Record<Lang, typeof en> = { en, zh }

/** Resolve a stored preference to a concrete language (System → OS/browser locale). */
function resolveLang(pref: LangPreference): Lang {
  if (pref === 'zh' || pref === 'en') return pref
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function readStored(): LangPreference {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  return raw === 'zh' || raw === 'en' || raw === 'system' ? raw : 'system'
}

/** Follow the dot-path into the active dictionary, then interpolate `{name}` vars. */
function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let node: unknown = DICTS[lang]
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined
  }
  if (typeof node !== 'string') return key
  if (!vars) return node
  return node.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`
  )
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string

interface LocaleContextValue {
  /** Resolved, concrete language currently in effect. */
  lang: Lang
  /** The user's stored choice (`system` means "follow the OS"). */
  preference: LangPreference
  setPreference: (pref: LangPreference) => void
  t: TFunction
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<LangPreference>(readStored)
  const lang = resolveLang(preference)

  const setPreference = useCallback((pref: LangPreference) => {
    setPreferenceState(pref)
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* persistence is best-effort */
    }
  }, [])

  // Keep the document language in sync for accessibility / native spellcheck.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<LocaleContextValue>(
    () => ({
      lang,
      preference,
      setPreference,
      t: (key, vars) => translate(lang, key, vars)
    }),
    [lang, preference, setPreference]
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale/useT must be used within a LocaleProvider')
  return ctx
}

/** Access the translation function. */
export function useT(): TFunction {
  return useLocaleContext().t
}

/** Access + change the language preference (for the settings switcher). */
export function useLocale(): Pick<LocaleContextValue, 'lang' | 'preference' | 'setPreference'> {
  const { lang, preference, setPreference } = useLocaleContext()
  return { lang, preference, setPreference }
}
