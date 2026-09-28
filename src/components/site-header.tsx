"use client"

import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { ThemeToggle } from "@/components/theme-toggle"

export function SiteHeader() {
  const { t } = useI18n()
  return (
    <header className="flex h-16 items-center justify-between gap-3">
      <Link href="/" className="text-base font-semibold tracking-tight">
        insitu<span className="text-primary">.</span>
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href="/gizlilik"
          className="hidden min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:inline-flex"
        >
          <ShieldCheck className="size-3.5 text-primary" aria-hidden />
          {t.header.privacy}
        </Link>
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  )
}
