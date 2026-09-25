import { read, SSF, utils, type CellObject } from "xlsx"

const pad = (n: number) => String(n).padStart(2, "0")

/** Excel serial → "YYYY-MM-DD[ HH:MM:SS]" without going through JS Date (no timezone shifts). */
function serialToIso(serial: number): string | null {
  const d = SSF.parse_date_code(serial)
  if (!d) return null
  const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`
  return d.H || d.M || d.S ? `${date} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}` : date
}

/**
 * First sheet of an Excel workbook as CSV text: raw numbers (no thousands formatting)
 * and ISO dates, so the load-time cleaner sees unambiguous values.
 */
export function xlsxToCsv(data: ArrayBuffer): string {
  const workbook = read(data, { dense: true, cellNF: true })
  const name = workbook.SheetNames[0]
  const sheet = name === undefined ? undefined : workbook.Sheets[name]
  if (!sheet) throw new Error("no-sheet")

  const rows: (CellObject | undefined)[][] = sheet["!data"] ?? []
  for (const row of rows) {
    for (const cell of row ?? []) {
      if (cell?.t === "n" && typeof cell.v === "number" && cell.z !== undefined && SSF.is_date(cell.z)) {
        const iso = serialToIso(cell.v)
        if (iso) Object.assign(cell, { t: "s", v: iso, w: iso })
      }
    }
  }
  return utils.sheet_to_csv(sheet, { rawNumbers: true, blankrows: false })
}
