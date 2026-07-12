import { useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { searchModels } from '@/data/known-models'
import { useT } from '@/i18n'

interface ModelsInputProps {
  value: string[]
  onChange: (models: string[]) => void
  id?: string
}

/**
 * A tag-style editor for a channel's `models` list. Users type a keyword to get matching
 * suggestions from a static known-models list (click or ↑/↓+Enter to add), but can still
 * type any id and press Enter/comma to add it freely. Each chip has a remove button;
 * duplicates and blanks are ignored, and comma-separated paste is split on commit.
 */
export function ModelsInput({ value, onChange, id }: ModelsInputProps): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  // -1 means "no suggestion highlighted" — Enter then commits the free text instead.
  const [activeIndex, setActiveIndex] = useState(-1)

  const suggestions = useMemo(() => searchModels(text, value), [text, value])
  const open = focused && text.trim().length > 0 && suggestions.length > 0

  const commit = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setText('')
    setActiveIndex(-1)
    if (parts.length === 0) return
    const next = [...value]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setActiveIndex(-1)
      setFocused(false)
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (e.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
        commit(suggestions[activeIndex].id)
      } else {
        commit(text)
      }
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const remove = (model: string): void => onChange(value.filter((m) => m !== model))

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent p-1.5">
        {value.map((model) => (
          <Badge key={model} variant="secondary" className="gap-1 font-normal">
            {model}
            <button
              type="button"
              onClick={() => remove(model)}
              className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
              aria-label={t('models.remove', { model })}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <Input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActiveIndex(-1)
            // Escape closes the list without blurring; typing again should reopen it.
            setFocused(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit(text)
          }}
          placeholder={value.length > 0 ? t('models.addPlaceholder') : t('models.emptyPlaceholder')}
          className="h-7 min-w-[10rem] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
        />
      </div>

      {open ? (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {suggestions.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                // Commit on mousedown (preventing default) so the input keeps focus and
                // the blur handler doesn't close the list before the click registers.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(m.id)
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                  i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                )}
              >
                <span className="truncate font-mono text-xs">{m.id}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{m.provider}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
