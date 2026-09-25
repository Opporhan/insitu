"use client"

import { ShieldCheck } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { ThemeToggle } from "@/components/theme-toggle"

export function SiteHeader() {
  const { t } = useI18n()
  return (
    <header className="flex h-16 items-center justify-between gap-3">
      <span className="text-base font-semibold tracking-tight">
        insitu<span className="text-primary">.</span>
      </span>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden />
          {t.header.privacy}
        </span>
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  )
}
