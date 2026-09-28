import type { Metadata } from "next"
import { PrivacyContent } from "@/components/privacy-content"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { messages } from "@/lib/i18n"

export const metadata: Metadata = {
  title: messages.tr.privacy.metaTitle,
  description: messages.tr.privacy.intro,
  alternates: { canonical: "/gizlilik" },
}

export default function Privacy() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
      <SiteHeader />
      <main className="flex flex-1 flex-col py-12">
        <PrivacyContent />
      </main>
      <SiteFooter />
    </div>
  )
}
