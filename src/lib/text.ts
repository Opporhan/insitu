/** "toplam", "Toplamı", "Genel Toplam", "Total" … anywhere in a label. */
export function hasTotalWord(s: string): boolean {
  return /(^|[\s_(])(toplam\p{L}*|total\p{L}*)/iu.test(s)
}

/**
 * Collapses an immediately repeated word ("Toplam Toplam Ciro" → "Toplam Ciro"),
 * case-insensitively. Only for generated text (titles, labels, notes) — never data values.
 */
export function dedupeAdjacentWords(s: string): string {
  return s.replace(/(^|\s)(\p{L}+)(\s+\2)+(?=\s|$|[.,:;!?)])/giu, (_, pre: string, word: string) => `${pre}${word}`)
}

/** First letter uppercase, Turkish-aware ("ilçe" → "İlçe"). */
export function capitalize(s: string, locale: string): string {
  return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1)
}
