"use client"

import { useState, type DragEvent } from "react"
import { FileSpreadsheet, Link2, Loader2, ShieldCheck } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { ACCEPTED_EXTENSIONS } from "@/lib/engine/load-file"
import type { PdfProgress } from "@/lib/ingest"
import { cn } from "@/lib/utils"

type Props = {
  loading: boolean
  /** Replaces the generic loading text (e.g. while a linked file downloads). */
  loadingText: string | null
  /** Page-by-page progress while a PDF is read (or OCR'd). */
  progress: PdfProgress | null
  error: string | null
  onFile: (file: File) => void
  onSample: () => void
  /** Opens a Google Sheets or GitHub file link (downloaded straight into the browser). */
  onUrl: (url: string) => void
}

export function Dropzone({ loading, loadingText, progress, error, onFile, onSample, onUrl }: Props) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState("")

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "group relative flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card px-6 py-12 text-center transition-colors duration-200",
          "hover:border-primary/60 has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
          dragging && "border-primary bg-primary/5",
        )}
      >
        <input
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          disabled={loading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ""
          }}
        />
        <span className="flex size-12 items-center justify-center rounded-xl border bg-background text-primary">
          {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <FileSpreadsheet className="size-5" aria-hidden />}
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-base font-medium" aria-live="polite">
            {!loading
              ? t.dropzone.drop
              : progress?.step === "ocr"
                ? t.dropzone.ocr(progress.page, progress.pages)
                : progress?.step === "verify"
                  ? t.dropzone.verify(progress.page, progress.pages)
                : progress
                  ? t.dropzone.readingPdf(progress.page, progress.pages)
                  : (loadingText ?? t.dropzone.loading)}
          </span>
          <span className="text-sm text-muted-foreground">{t.dropzone.orClick} · .csv, .xlsx, .xls, .pdf</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden />
          {t.dropzone.privacy}
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) onUrl(url.trim())
        }}
      >
        <label htmlFor="import-url" className="text-center text-sm text-muted-foreground">
          {t.dropzone.urlLabel}
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id="import-url"
              type="text"
              spellCheck={false}
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t.dropzone.urlPlaceholder}
              disabled={loading}
              className="h-11 w-full rounded-md border bg-card pr-3 pl-9 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </div>
          <Button type="submit" variant="outline" className="h-11 px-4" disabled={loading || !url.trim()}>
            {t.dropzone.urlOpen}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">{t.dropzone.urlHint}</p>
      </form>

      <Button variant="ghost" className="h-11 self-center text-muted-foreground" onClick={onSample} disabled={loading}>
        {t.dropzone.sample}
      </Button>
    </div>
  )
}
