"use client"

import { useState, type DragEvent } from "react"
import { FileSpreadsheet, Loader2, ShieldCheck } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { ACCEPTED_EXTENSIONS } from "@/lib/engine/load-file"
import { cn } from "@/lib/utils"

type Props = {
  loading: boolean
  error: string | null
  onFile: (file: File) => void
  onSample: () => void
}

export function Dropzone({ loading, error, onFile, onSample }: Props) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)

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
          <span className="text-base font-medium">
            {loading ? t.dropzone.loading : t.dropzone.drop}
          </span>
          <span className="text-sm text-muted-foreground">{t.dropzone.orClick} · .csv, .xlsx, .xls</span>
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

      <Button variant="ghost" className="h-11 self-center text-muted-foreground" onClick={onSample} disabled={loading}>
        {t.dropzone.sample}
      </Button>
    </div>
  )
}
