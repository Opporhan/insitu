"use client"

import Link from "next/link"
import { useI18n } from "@/components/i18n-provider"
import { REPO_URL } from "@/lib/site"

export function SiteFooter() {
  const { t } = useI18n()
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-6 text-xs text-muted-foreground">
      <Link href="/gizlilik" className="inline-flex min-h-11 items-center hover:text-foreground">
        {t.privacy.title}
      </Link>
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center hover:text-foreground">
        {t.privacy.source}
      </a>
    </footer>
  )
}
