"use client"

import { useState, type FormEvent } from "react"
import { ArrowRight, Loader2, Search } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Props = {
  busy: boolean
  suggestions: readonly string[]
  onAsk: (question: string) => void
}

export function AskBar({ busy, suggestions, onAsk }: Props) {
  const { t } = useI18n()
  const [question, setQuestion] = useState("")

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = question.trim()
    if (q.length >= 2 && !busy) onAsk(q)
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="relative" role="search">
        <label htmlFor="question" className="sr-only">
          {t.ask.label}
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.ask.placeholder}
          autoComplete="off"
          autoFocus
          className="h-14 rounded-xl bg-card pr-16 pl-11 text-base md:text-base"
        />
        <Button
          type="submit"
          size="icon-lg"
          aria-label={t.ask.submit}
          disabled={busy || question.trim().length < 2}
          className="absolute top-1/2 right-2 size-11 -translate-y-1/2 rounded-lg"
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
        </Button>
      </form>

      {suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t.ask.examples}>
          {suggestions.map((s) => (
            <li key={s}>
              <Button
                variant="outline"
                className="h-11 rounded-full px-4 text-muted-foreground"
                disabled={busy}
                onClick={() => {
                  setQuestion(s)
                  onAsk(s)
                }}
              >
                {s}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
