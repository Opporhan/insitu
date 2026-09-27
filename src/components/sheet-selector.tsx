"use client"

import { Sheet } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCount } from "@/lib/format"
import type { SheetInfo } from "@/lib/ingest"

type Props = {
  fileName: string
  sheets: readonly SheetInfo[]
  loading: boolean
  onPick: (sheet: string) => void
  onCancel: () => void
}

export function SheetSelector({ fileName, sheets, loading, onPick, onCancel }: Props) {
  const { t, locale } = useI18n()
  // PDF tables carry their page range; workbook sheets have names.
  const pdf = sheets.some((s) => s.pages)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg tracking-tight">{pdf ? t.sheets.pdfTitle : t.sheets.title}</CardTitle>
        <CardDescription>{pdf ? t.sheets.pdfBody(fileName) : t.sheets.body(fileName)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="grid gap-2 sm:grid-cols-2">
          {sheets.map((s) => (
            <li key={s.name}>
              <Button
                variant="outline"
                className="h-auto min-h-14 w-full justify-start gap-3 px-4 py-3 text-left"
                disabled={loading}
                onClick={() => onPick(s.name)}
              >
                <Sheet className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{s.pages ? t.sheets.pdfTable(s.name, s.pages) : s.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t.sheets.size(formatCount(s.rows, locale), s.columns)}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" className="h-11 self-start text-muted-foreground" disabled={loading} onClick={onCancel}>
          {t.sheets.cancel}
        </Button>
      </CardContent>
    </Card>
  )
}
