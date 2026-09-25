"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { LOCALE_COOKIE, messages, type Locale, type Messages } from "@/lib/i18n"

type I18n = { locale: Locale; t: Messages; setLocale: (locale: Locale) => void }

const I18nContext = createContext<I18n | null>(null)

/**
 * The server picks the initial locale from the cookie / Accept-Language, so the first
 * render is already in the right language (no flash, no hydration mismatch).
 */
export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale)

  function setLocale(next: Locale) {
    setLocaleState(next)
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = next
    document.title = messages[next].meta.title
  }

  return <I18nContext.Provider value={{ locale, t: messages[locale], setLocale }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>")
  return ctx
}
