import { InsituApp } from "@/components/insitu-app"
import { SiteHeader } from "@/components/site-header"

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
      <SiteHeader />
      <main className="flex flex-1 flex-col justify-center py-12">
        <InsituApp />
      </main>
    </div>
  )
}
