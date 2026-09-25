import { z } from "zod"
import { guardSql } from "@/lib/engine/guard"
import { ChartType, QueryPlan, ValueFormat, type TranslateRequest, type TranslateResponse } from "@/lib/schema"
import { messages } from "@/lib/i18n"
import { suggestQuestions } from "@/lib/suggestions"
import type { QueryTranslator } from "./types"

// Tried in order. Free-tier quotas are per model, so a model that is rate-limited (429),
// overloaded (500/503) or too slow hands over to the next one.
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.1-flash-lite"] as const
const RETRY_NEXT_MODEL = new Set([429, 500, 503])
const MODEL_TIMEOUT_MS = 30_000

class GeminiHttpError extends Error {
  constructor(readonly status: number) {
    super(`Gemini HTTP ${status}`)
  }
}

function endpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

const SYSTEM_PROMPT = `Sen Insitu'nun Text-to-SQL ve grafik planlama motorusun. Kullanıcının günlük dildeki (çoğunlukla Türkçe) sorusunu, tarayıcıda DuckDB-WASM üzerinde çalışacak TEK bir SQL sorgusuna ve bir grafik planına çevirirsin.

Yalnızca tablonun sütun adlarını ve tiplerini görürsün. Satır verisini, değerleri ve sonuçları asla görmezsin; bu yüzden sonuç hakkında sayı veya yorum UYDURMA.

## 1. SQL standartları (DuckDB)
- Yalnızca geçerli DuckDB SQL üret. Tablonun adı: data.
- Yalnızca tek bir SELECT (veya WITH ... SELECT). INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, COPY, ATTACH, PRAGMA, SET, INSTALL, LOAD, read_csv/read_parquet/glob gibi dosya fonksiyonları, noktalı virgül ve yorum (-- veya /* */) KESİNLİKLE yasak.
- Kaynak tablodaki sütun adlarını HER ZAMAN çift tırnakla yaz ("urun_adi", "ürün adı").
- Sonuçtaki her sütuna ASCII snake_case bir takma ad ver (AS toplam_ciro, AS kategori). Takma adlar benzersiz olmalı.
- Tarih gruplamalarında date_trunc ve strftime kullan. Tarih çıktılarını her zaman metne çevir: gün için strftime(x, '%Y-%m-%d'), ay için strftime(date_trunc('month', x), '%Y-%m'), yıl için strftime(x, '%Y'). Tarih sütunu metin tipindeyse önce TRY_CAST("t" AS DATE).
- Hafta içi/sonu: isodow("t") IN (6, 7) hafta sonudur. Gün adı gerekirse CASE isodow("t") WHEN 1 THEN 'Pazartesi' ... WHEN 7 THEN 'Pazar' END.
- Bölme ve oranlarda sıfıra bölmeye karşı daima NULLIF kullan: SUM(a) / NULLIF(SUM(b), 0).
- Yüzdeleri 0–100 ölçeğinde üret: 100.0 * pay / NULLIF(payda, 0).
- SQL içinde yuvarlama (ROUND) yapma; biçimlendirmeyi istemci yapar.
- Kümülatif toplam: SUM(SUM(x)) OVER (ORDER BY donem).
- Dönemsel değişim: LAG(...) OVER (ORDER BY donem) ve NULLIF.
- "Bu ay", "son 30 gün", "bu yıl" gibi göreli dönemler bugüne göre değil, verideki en son tarihe göre hesaplanır.
  - "Son N gün" = en son gün DAHİL tam N gün: "t" > (SELECT MAX("t") FROM data) - INTERVAL N DAY. Burada ">=" KULLANMA (N+1 gün olur).
  - "Bu ay": date_trunc('month', "t") = (SELECT MAX(date_trunc('month', "t")) FROM data).
- Ay adıyla filtre (Ocak, Şubat…): month("t") = 1, 2… Ay bazında gösterirken strftime(date_trunc('month', "t"), '%Y-%m') kullan ve kronolojik sırala.
- Metin değer filtresi: kullanıcının yazdığı değeri Türkçe doğru büyük/küçük harfle tam eşleştir ("sehir" = 'İzmir').
- "İçeren"/"geçen" aramaları (ZORUNLU kural): ILIKE ile kelimenin tamamını DEĞİL, küçük harfli KÖKÜNÜ ara. Türkçede ek alınca son harfler değişir (Kulaklık → Kulaklığı, Kitap → Kitabı, Ağaç → Ağacı), bu yüzden son 1–2 harfi at:
  "Kulaklık" → ILIKE '%kulakl%' · "Klavye" → ILIKE '%klavy%' · "Kitap" → ILIKE '%kita%' · "Çanta" → ILIKE '%çant%'.
  ASLA ILIKE '%kulaklık%' yazma; "Oyuncu Kulaklığı" kaçar.
- Farklı uzunlukta grupları karşılaştırırken (ör. hafta içi 5 gün, hafta sonu 2 gün) toplam yerine gün başına ortalamayı kullan ve bunu sütun etiketinde belirt ("Günlük ort. ciro").
- Kullanıcı açıkça bir sayı istemedikçe ("ilk 20", "son 5") LIMIT KOYMA; "tüm/hepsi" isteklerinde asla. İstemci büyük sonuçları güvenle kendisi sınırlar ve kesildiğini kullanıcıya söyler; senin koyacağın bir LIMIT ise sonucu sessizce eksik gösterir.
- En düşük / minimum tutar sorularında tutarı 0 olan kayıtlar (iade, iptal) sonucu anlamsız kılar: MIN hesabında "tutar" > 0 filtresi uygula ve etikette belirt ("En Düşük Sipariş (iade hariç)").
- "Pahalı/ucuz", "büyük/küçük sipariş" gibi göreli kavramlarda sabit TL eşiği UYDURMA; eşiği veriden hesapla (ör. medyan: (SELECT median("birim_fiyat") FROM data)) ve etikette "Medyan üstü/altı" gibi belirt.
- Haftalık gruplamada date_trunc('week', …) haftanın Pazartesi'sini verir; etiketi "Hafta başı" yap.

## 2. İş kavramları
- Ciro/gelir/satış tutarı/kazanç: tutar, toplam, ciro gibi bir sütun varsa onu SUM et; yoksa birim fiyat × adet.
- Sipariş sayısı: sipariş numarası/kimliği sütunu varsa COUNT(DISTINCT o_sütun); yoksa COUNT(*).
- DİKKAT: "sipariş adedi", "sipariş sayısı", "kaç sipariş" = sipariş SAYISI (COUNT DISTINCT). "Ürün adedi", "satılan adet", "kaç ürün satıldı" = SUM("adet"). Bunları karıştırma.
- Ortalama sepet/sipariş tutarı (AOV): SUM(ciro) / NULLIF(COUNT(DISTINCT sipariş_no), 0).
- Sipariş başına ortalama adet: SUM(adet) / NULLIF(COUNT(DISTINCT sipariş_no), 0).
- Benzersiz müşteri: COUNT(DISTINCT müşteri_sütunu). Ürün çeşidi: COUNT(DISTINCT ürün_sütunu).
- Tekil sipariş cirosu: önce sipariş numarasına göre GROUP BY ile sipariş toplamını bul, sonra sırala.
- Günlük dilde sorulan muğlak sorular ("işler nasıl?", "kim ne kadar kazandırdı?", "millet ne alıyor?") için veriye en uygun ciro, adet, tarih ve kategori sütunlarını seç ve makul bir yorum yap.

## 3. Grafik tipi (chartType)
- "metric": tek bir sayı, toplam, ortalama, oran veya sayım. Sorgu TEK satır döndürür (1–4 sayısal sütun). xAxisKey, yAxisKey, seriesKey "".
- "bar": kategorik karşılaştırma veya sıralama. xAxisKey = kategori sütunu, yAxisKey = sayısal sütun. Varsayılan ORDER BY y DESC; "en az/en düşük" istenirse ASC; aylar veya gün adları gibi doğal sıralı kategorilerde doğal sıra. En fazla 30 kategori.
  - "Hangisi?", "hangi ayda zirve?", "en çok hangi şehir?" gibi TEK kazanan sorularında bile LIMIT 1 KULLANMA: bağlam için tüm grupları (en fazla 15) sıralı döndür; istemci kazananı vurgular. Yalnızca "ilk N" istenirse LIMIT N.
- "line": zaman, tarih, ay trendi. xAxisKey = dönem metni (artan sırada), yAxisKey = sayısal değer.
- Çok serili bar/line (ör. kategorilerin aylık trendi): uzun format döndür (dönem, seri, değer) ve seriesKey = seri sütunu. En fazla 8 seri; daha fazlaysa en büyük 8'i filtrele.
- "pie": bir bütünün oransal parçaları (dağılım, pay, oran). xAxisKey = dilim adı, yAxisKey = negatif olmayan HAM toplam (SUM veya COUNT; ortalama veya yüzde DEĞİL). Tüm grupları döndür; istemci payları hesaplar ve 7'den fazla dilimi "Diğer" altında birleştirir.
- "table": çok boyutlu döküm, birden fazla ölçüt, kayıt listeleri. Sütunları mantıklı sırala.
  - "Hangi ürünler/şehirler/müşteriler…?" soruları o varlık bazında GRUPLANMIŞ, tekrarsız bir liste ister (GROUP BY varlık + ilgili toplamlar), ham satır dökümü değil. Tek bir ölçüt varsa bar da olabilir.
  - "X ile Y aynı mı?" / "hangisi daha …?" karşılaştırmalarında her ölçütü ayrı satırda gösteren küçük bir tablo döndür (ör. sütunlar: olcut, urun, deger), böylece cevap tabloda doğrudan görünsün.

## 4. Çıktı sütunları (columns)
Final SELECT'teki HER sütunu aynı sırayla columns dizisinde tanımla:
- key: SQL takma adıyla birebir aynı.
- label: kısa Türkçe başlık ("Toplam Ciro", "Sipariş Sayısı", "Şehir").
- format: "currency" (TL tutarları), "integer" (adet, sayım), "number" (para olmayan ortalamalar, katsayılar), "percent" (0–100 ölçeğinde yüzde), "text", "date" ('YYYY-MM-DD' metni), "month" ('YYYY-MM' metni).
- total: satırlar boyunca bu sütunu TOPLAMAK anlamlıysa true (tutar, ciro, adet, sipariş sayısı gibi toplanabilir miktarlar). Birim fiyat, ortalama, oran, yüzde, kümülatif değer, metin ve tarihler için false. İstemci true olan sütunların genel toplamını tablonun altında gösterir; "listesi ve toplamı" soruları böyle cevaplanır.

## 5. Diğer alanlar
- title: grafiğin kısa Türkçe başlığı (en fazla 60 karakter).
- explanation: normalde "". Soru tabloda OLMAYAN bir sütun/kavram gerektiriyorsa sql = "" yap ve explanation'da hangi bilginin eksik olduğunu nazik bir Türkçe cümleyle belirt (ör. "Tabloda müşteri memnuniyeti bilgisi bulunmuyor.").`

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sql: { type: "string" },
    chartType: { type: "string", enum: ChartType.options },
    xAxisKey: { type: "string" },
    yAxisKey: { type: "string" },
    seriesKey: { type: "string" },
    title: { type: "string" },
    explanation: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          format: { type: "string", enum: ValueFormat.options },
          total: { type: "boolean" },
        },
        required: ["key", "label", "format", "total"],
      },
    },
  },
  required: ["sql", "chartType", "xAxisKey", "yAxisKey", "seriesKey", "title", "explanation", "columns"],
} as const

const ModelAnswer = z.object({
  sql: z.string(),
  chartType: z.string(),
  xAxisKey: z.string(),
  yAxisKey: z.string(),
  seriesKey: z.string(),
  title: z.string(),
  explanation: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string(), format: z.string(), total: z.boolean() })),
})
export type ModelAnswer = z.infer<typeof ModelAnswer>

const GeminiResponse = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) }))
    .min(1),
})

const LANGUAGE_RULE = {
  tr: "Yanıt dili: Türkçe. title, columns[].label, explanation ve SQL içinde senin ürettiğin etiket metinleri (CASE sonuçları gibi) Türkçe olsun.",
  en: "Response language: English. Write title, columns[].label, explanation and any label text you create inside the SQL (e.g. CASE results such as 'Weekend') in English. Values that come from the data (city or product names used in filters) stay exactly as the user wrote them.",
} as const

function userPrompt({ question, columns, repair, locale = "tr" }: TranslateRequest, problem: string | null): string {
  const list = columns.map((c) => `- "${c.name}" (${c.type})`).join("\n")
  let prompt = `${LANGUAGE_RULE[locale]}\n\nTablo: data\nSütunlar:\n${list}\n\nSoru: ${question}`
  const fix = problem ?? (repair ? `Önceki SQL tarayıcıda şu hatayı verdi: ${repair.error}\nÖnceki SQL:\n${repair.sql}` : null)
  if (fix) prompt += `\n\nDÜZELTME GEREKİYOR. ${fix}\nAynı soruyu, bu sorunu gideren yeni bir planla yanıtla.`
  return prompt
}

async function callGemini(apiKey: string, prompt: string): Promise<unknown> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0,
      thinkingConfig: { thinkingLevel: "medium" },
    },
  })
  const init = { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body }

  let res: Response | undefined
  let lastStatus = 0
  for (const model of MODELS) {
    try {
      res = await fetch(endpoint(model), { ...init, signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) })
    } catch {
      res = undefined // timed out; try the next model
      continue
    }
    lastStatus = res.status
    if (!RETRY_NEXT_MODEL.has(res.status)) break
  }
  if (!res?.ok) throw new GeminiHttpError(lastStatus)

  const parsed = GeminiResponse.parse(await res.json())
  const text = parsed.candidates[0]?.content.parts.map((p) => p.text ?? "").join("") ?? ""
  return JSON.parse(text)
}

const NEEDS_AXES: ReadonlySet<string> = new Set(["bar", "line", "pie"])

/** Structural checks on the plan. Returns a problem the model can fix, or null. */
export function planProblem(answer: ModelAnswer): string | null {
  const guarded = guardSql(answer.sql)
  if (!guarded.ok) return `SQL reddedildi: ${guarded.error}`
  const keys = answer.columns.map((c) => c.key)
  if (keys.length === 0) return "columns dizisi boş; final SELECT'teki her sütunu tanımla."
  if (new Set(keys).size !== keys.length) return "columns içinde tekrar eden key var."
  if (NEEDS_AXES.has(answer.chartType)) {
    if (!keys.includes(answer.xAxisKey)) return `xAxisKey ("${answer.xAxisKey}") columns içindeki bir key olmalı.`
    if (!keys.includes(answer.yAxisKey)) return `yAxisKey ("${answer.yAxisKey}") columns içindeki bir key olmalı.`
    if (answer.seriesKey && !keys.includes(answer.seriesKey)) {
      return `seriesKey ("${answer.seriesKey}") columns içindeki bir key olmalı.`
    }
  }
  return null
}

export function toPlan(answer: ModelAnswer): ReturnType<typeof QueryPlan.safeParse> {
  const axes = NEEDS_AXES.has(answer.chartType)
  return QueryPlan.safeParse({
    sql: guardSql(answer.sql).ok ? answer.sql.trim().replace(/;\s*$/, "") : answer.sql,
    chartType: answer.chartType,
    xAxisKey: axes ? answer.xAxisKey : "",
    yAxisKey: axes ? answer.yAxisKey : "",
    seriesKey: axes && answer.chartType !== "pie" ? answer.seriesKey : "",
    title: answer.title.trim().slice(0, 120) || "Sonuç",
    columns: answer.columns,
  })
}

/** Sends only the question and column headers to Gemini; row data never reaches this module. */
export function geminiTranslator(apiKey: string): QueryTranslator {
  return {
    async translate(request): Promise<TranslateResponse> {
      const locale = request.locale ?? "tr"
      const t = messages[locale].server
      const fail = (error: string): TranslateResponse => ({
        ok: false,
        error,
        suggestions: suggestQuestions(request.columns, locale),
      })

      let problem: string | null = null
      // One attempt plus one self-correction for structural problems (no data involved).
      for (let attempt = 0; attempt < 2; attempt++) {
        let answer: ModelAnswer
        try {
          answer = ModelAnswer.parse(await callGemini(apiKey, userPrompt(request, problem)))
        } catch (e) {
          console.error("[translate] Gemini failed:", e instanceof Error ? e.message : e)
          return fail(e instanceof GeminiHttpError && e.status === 429 ? t.quota : t.unavailable)
        }

        if (!answer.sql.trim()) return fail(answer.explanation.trim() || t.notAnswerable)

        problem = planProblem(answer)
        if (problem) continue
        const plan = toPlan(answer)
        if (plan.success) return { ok: true, plan: plan.data }
        problem = `Plan şemaya uymuyor: ${plan.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      }
      console.error("[translate] invalid plan after retry:", problem)
      return fail(t.unreliable)
    },
  }
}
