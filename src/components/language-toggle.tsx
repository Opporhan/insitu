"use client"

import { useI18n } from "@/components/i18n-provider"
import { LOCALES, messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Two-segment TR | EN switch; the active language is highlighted. */
export function LanguageToggle() {
  const { locale, t, setLocale } = useI18n()
  return (
    <div role="group" aria-label={t.header.language} className="flex h-11 items-center rounded-lg border p-1">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          aria-label={messages[l].languageName}
          onClick={() => setLocale(l)}
          className={cn(
            "h-full min-w-11 rounded-md px-2 font-mono text-xs font-medium uppercase transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            l === locale ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
