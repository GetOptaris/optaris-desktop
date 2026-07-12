import { useState } from 'react'
import { XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface ModelsInputProps {
  value: string[]
  onChange: (models: string[]) => void
  id?: string
}

/**
 * A small tag-style editor for a channel's `models` list. Users type a model id and
 * press Enter or comma to add a chip; each chip has a remove button. Duplicates and
 * blanks are ignored. Also accepts comma-separated paste (split on commit).
 */
export function ModelsInput({ value, onChange, id }: ModelsInputProps): React.JSX.Element {
  const [text, setText] = useState('')

  const commit = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length === 0) {
      setText('')
      return
    }
    const next = [...value]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(text)
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const remove = (model: string): void => onChange(value.filter((m) => m !== model))

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent p-1.5">
      {value.map((model) => (
        <Badge key={model} variant="secondary" className="gap-1 font-normal">
          {model}
          <button
            type="button"
            onClick={() => remove(model)}
            className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
            aria-label={`Remove ${model}`}
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(text)}
        placeholder={value.length > 0 ? 'Add model…' : 'e.g. gpt-4o, claude-3-5-sonnet'}
        className="h-7 min-w-[10rem] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  )
}
