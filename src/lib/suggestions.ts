import { DEFAULT_LOCALE, messages, type Locale } from "@/lib/i18n"
import type { Column } from "@/lib/schema"

function fold(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
}

const ID_TOKENS = new Set(["no", "nr", "id", "kod", "kodu", "code", "numara", "numarasi", "number", "sira", "index", "idx", "sn", "uuid", "ref"])

/**
 * Identifier-like columns ("Sipariş No", "firma_kodu", "S/N", "Sıra No", "musteri_id")
 * are poor groupings and meaningless measures, so suggestions skip them.
 */
export function isIdLike(name: string): boolean {
  const tokens = fold(name).split(/[^a-z0-9]+/).filter(Boolean)
  const last = tokens[tokens.length - 1] ?? ""
  return ID_TOKENS.has(last) || ID_TOKENS.has(tokens.join(""))
}

// Amounts first: "tutar" answers "how much did we sell", "birim_fiyat" does not.
const AMOUNT_LIKE = /tutar|ciro|gelir|satis|amount|revenue|total|toplam|sales/
const PRICE_LIKE = /fiyat|price/

/**
 * Common business words in column names: ASCII form → proper Turkish and English.
 * Used to restore Turkish letters in ASCII headers ("sehir" → "şehir") and, in the English
 * UI, to translate a name only when every word is known ("satis tutari" → "sales amount").
 */
const VOCAB: Record<string, { tr: string; en: string }> = {
  sehir: { tr: "şehir", en: "city" }, il: { tr: "il", en: "province" }, ilce: { tr: "ilçe", en: "district" },
  bolge: { tr: "bölge", en: "region" }, ulke: { tr: "ülke", en: "country" }, sube: { tr: "şube", en: "branch" },
  magaza: { tr: "mağaza", en: "store" }, urun: { tr: "ürün", en: "product" }, kategori: { tr: "kategori", en: "category" },
  marka: { tr: "marka", en: "brand" }, firma: { tr: "firma", en: "company" }, musteri: { tr: "müşteri", en: "customer" },
  tedarikci: { tr: "tedarikçi", en: "supplier" }, calisan: { tr: "çalışan", en: "employee" }, personel: { tr: "personel", en: "staff" },
  departman: { tr: "departman", en: "department" }, temsilci: { tr: "temsilci", en: "representative" }, satici: { tr: "satıcı", en: "seller" },
  ad: { tr: "ad", en: "name" }, adi: { tr: "adı", en: "name" }, isim: { tr: "isim", en: "name" }, tur: { tr: "tür", en: "type" },
  turu: { tr: "türü", en: "type" }, tip: { tr: "tip", en: "type" }, tipi: { tr: "tipi", en: "type" },
  tutar: { tr: "tutar", en: "amount" }, tutari: { tr: "tutarı", en: "amount" }, ciro: { tr: "ciro", en: "revenue" },
  gelir: { tr: "gelir", en: "income" }, geliri: { tr: "geliri", en: "income" }, gider: { tr: "gider", en: "expense" },
  maliyet: { tr: "maliyet", en: "cost" }, kar: { tr: "kâr", en: "profit" }, fiyat: { tr: "fiyat", en: "price" },
  fiyati: { tr: "fiyatı", en: "price" }, birim: { tr: "birim", en: "unit" }, adet: { tr: "adet", en: "quantity" },
  miktar: { tr: "miktar", en: "quantity" }, miktari: { tr: "miktarı", en: "quantity" }, satis: { tr: "satış", en: "sales" },
  siparis: { tr: "sipariş", en: "order" }, odeme: { tr: "ödeme", en: "payment" }, yontem: { tr: "yöntem", en: "method" },
  yontemi: { tr: "yöntemi", en: "method" }, durum: { tr: "durum", en: "status" }, durumu: { tr: "durumu", en: "status" },
  tarih: { tr: "tarih", en: "date" }, tarihi: { tr: "tarihi", en: "date" }, indirim: { tr: "indirim", en: "discount" },
  stok: { tr: "stok", en: "stock" }, puan: { tr: "puan", en: "score" }, yas: { tr: "yaş", en: "age" },
  cinsiyet: { tr: "cinsiyet", en: "gender" }, kanal: { tr: "kanal", en: "channel" }, kampanya: { tr: "kampanya", en: "campaign" },
  toplam: { tr: "toplam", en: "total" }, net: { tr: "net", en: "net" }, brut: { tr: "brüt", en: "gross" },
  kdv: { tr: "KDV", en: "VAT" }, maas: { tr: "maaş", en: "salary" }, prim: { tr: "prim", en: "bonus" },
}

/**
 * A readable name for a column: the file's original header when known ("Tutar (TL) 💰"
 * → "tutar"), else the column name with underscores as spaces ("firma_kodu" → "firma kodu").
 * Short all-caps words (KDV, TL) keep their case. ASCII-only Turkish words get their letters
 * back; in English, names made only of known words are translated.
 */
export function humanize(name: string, original?: string, locale: Locale = DEFAULT_LOCALE): string {
  const words = readableWords(name, original)
  const known = words.map((w) => VOCAB[fold(w)])
  if (locale === "en") return known.every(Boolean) ? known.map((k) => k?.en ?? "").join(" ") : words.join(" ")
  // Only replace words written without Turkish letters ("sehir"), never ones already correct.
  return words.map((w, i) => (known[i] && fold(w) === w ? (known[i]?.tr ?? w) : w)).join(" ")
}

function readableWords(name: string, original?: string): string[] {
  const source = original?.trim() ? original : name.replace(/_/g, " ")
  // An all-caps header ("İL", "ŞEHİR") is just shouting; keep caps only for acronyms in mixed-case headers.
  const mixedCase = /\p{Ll}/u.test(source)
  return source
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[_/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (mixedCase && /^[A-ZÇĞİÖŞÜ]{2,4}$/.test(w) ? w : w.toLocaleLowerCase("tr")))
}

/**
 * Example questions in everyday language, built from column headers only.
 * Turkish sentences keep column names free of suffixes so vowel harmony is never wrong
 * ("Toplam tutar en yüksek olan şehir hangisi?").
 */
export function suggestQuestions(
  columns: readonly Column[],
  locale: Locale = DEFAULT_LOCALE,
  originals: ReadonlyMap<string, string> = new Map(),
): string[] {
  const t = messages[locale].suggestions
  const label = (c: Column) => humanize(c.name, originals.get(c.name), locale)
  const texts = columns.filter((c) => c.type === "text" && !isIdLike(c.name))
  const numbers = columns.filter((c) => c.type === "number" && !isIdLike(c.name))
  const dim = texts[0]
  const num =
    numbers.find((c) => AMOUNT_LIKE.test(fold(c.name))) ?? numbers.find((c) => PRICE_LIKE.test(fold(c.name))) ?? numbers[0]
  const date = columns.find((c) => c.type === "date")

  const out: string[] = []
  if (num) {
    // "Toplam tutar", but never "Toplam toplam ciro" / "Toplam satış toplamı".
    const total = t.total(label(num))
    if (dim) out.push(t.top(total, label(dim)))
    if (date) out.push(t.trend(total))
    if (dim) out.push(t.share(total, label(dim)))
  } else {
    if (dim) out.push(t.countTop(label(dim)))
    if (date) out.push(t.countTrend)
    if (dim) out.push(t.countShare(label(dim)))
  }
  return out
}
