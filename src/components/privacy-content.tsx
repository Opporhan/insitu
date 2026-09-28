"use client"

import Link from "next/link"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"

/** What is processed where, in the UI language. */
export function PrivacyContent() {
  const { t } = useI18n()
  const p = t.privacy
  return (
    <article className="mx-auto flex max-w-[70ch] flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="inline-flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <ShieldCheck className="size-7 text-primary" aria-hidden /> {p.title}
        </h1>
        <p className="text-pretty text-muted-foreground">{p.intro}</p>
      </header>
      {p.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-pretty leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {p.back}
      </Link>
    </article>
  )
}
