@AGENTS.md

# Insitu - Proje Manifestosu ve Mantığı

## Neden "Insitu"?
*In situ*, Latince "kendi yerinde / çıktığı yerde işlenen" demektir. Bu projenin tüm varoluş amacı adında saklıdır: Kullanıcının şirket veya kişisel verisi asla bir sunucuya gitmez; her şey kullanıcının kendi cihazında, kendi tarayıcısında (yerinde) hesaplanır.

---

## Bu Proje Nedir?
Insitu; formül, kod veya karmaşık veri tabanı dilleri bilmeyen insanların elindeki Excel veya CSV tablolarıyla günlük konuşma diliyle sohbet etmesini sağlayan, gizlilik odaklı bir veri tercümanıdır.

Kullanıcı tablosunu bırakır, aklındaki soruyu bir iş arkadaşına sorar gibi yazar ve saniyeler içinde karşısına sunuma hazır temiz bir grafik ile tek cümlelik net bir içgörü çıkar.

---

## Sistemin Çalışma Mantığı (Adım Adım)

1. **Veriyi Yerinde Tut:** Kullanıcı CSV veya Excel dosyasını ekrana sürüklediğinde dosya hiçbir sunucuya yüklenmez. Tüm hesaplama tarayıcının kendi belleğinde gerçekleşir.
2. **Soruyu Anla:** Kullanıcı "Bu ay en çok kazandıran ilk 3 ürünü göster" dediğinde; sistem kullanıcının verilerini değil, yalnızca tablonun sütun başlıklarını (örneğin: `urun_adi`, `fiyat`, `tarih`) yapay zekaya iletir.
3. **Kodu Üret ve İçeride Çalıştır:** Yapay zeka bu başlıklara göre arka planda gerekli hesaplama kodunu yazar. Tarayıcı bu kodu kendi içinde çalıştırarak sonucu milisaniyeler içinde çıkarır.
4. **Sayı Yığınını Görsele Dönüştür:** Kullanıcıyı kuru rakamlarla boğmak yerine, soruya en uygun grafiği (çubuk, çizgi veya pasta) ekrana çizer.
5. **İşi Kolaylaştır:** Kullanıcı oluşan grafiği tek tıkla yüksek çözünürlüklü resim (PNG) veya özet tablo olarak indirip sunumuna ekler.

---

## Kırmızı Çizgilerimiz (Asla Yapılmayacaklar)

- **Veri Sızıntısına Sıfır Tolerans:** Kullanıcının ham satış, müşteri veya finans rakamlarını asla harici yapay zeka servislerine gönderme. Yapay zekaya yalnızca sütun isimleri ve gerekirse 1-2 adet temsili boş format örneği gösterilebilir.
- **Ajan Kalabalığından Kaçın:** Birbiriyle konuşan 4-5 farklı yapay zeka ajanı kurup sistemi yavaşlatma ve maliyeti artırma. Akış deterministiktir: *Dosyayı Oku ➔ Soruyu Çevir ➔ Kodu Çalıştır ➔ Grafiği Çiz.*
- **Kapsamı Dağıtma:** İlk sürümde PDF veya fatura fotoğrafı okumaya çalışma; odağımız hatasız ve hızlı çalışan **CSV ve Excel** dosyalarıdır.
- **Gereksiz Karmaşık Tasarım:** Sayfayı yüzlerce ayar düğmesiyle doldurma. Arayüz; bir dosya bırakma alanı, temiz bir arama çubuğu ve ortada parlayan bir grafikten ibaret olmalıdır.

---

## Arayüz Hissiyatı ve Tasarım Dili

- **Görünüm:** Sade, karanlık mod (Linear ve Vercel sadeliğinde koyu gri/siyah zeminler, göz yormayan zümrüt yeşili ve gece mavisi grafik renkleri).
- **Kullanıcı Deneyimi:** Kullanıcı karmaşık bir veri programında kaybolmuş gibi değil; hızlı, sessiz ve güvenilir bir arama motoru kullanıyormuş gibi hissetmelidir.
- **Şeffaflık:** Meraklı kullanıcılar için "Bu analizi nasıl hesapladım?" alanı tek tıkla arkada dönen kodu gösterebilmeli, ancak normal kullanıcı teknik detaylarla hiç muhatap olmamalıdır.

---

# Mühendislik Kuralları

Proje içi skill'ler `.claude/skills/` altındadır. İlgili işe başlamadan önce ilgili skill'i yükle.

| Skill | Ne zaman |
|---|---|
| `ui-ux-pro-max` | Her UI/bileşen/renk/grafik işi |
| `mastering-typescript` | Her `.ts/.tsx` dosyası, tip tasarımı, Zod şemaları (lisanssız olduğu için depoda yok; kurulumu README'de) |
| `nextjs-app-router-patterns` | Route, layout, Server/Client sınırı, Route Handler |

> Next.js 16 kullanılıyor; API'ler eğitim verisinden farklı olabilir. Şüphede `node_modules/next/dist/docs/` altındaki rehberi oku (bkz. AGENTS.md).

## Tasarım Yeteneği (UI/UX Protocol)
- Stil felsefesi: ui-ux-pro-max standartlarını uygula.
- Yalnızca Minimalism, Bento Grid ve Dark Mode kombinasyonunu kullan.
- Bileşenlerde shadcn/ui, grafiklerde SVG tabanlı Recharts tercih et.

Ayrıntılar: **`docs/design-system.md`** (renk token'ları, tipografi, grafik seçimi, UX kontrol listesi). Özet:
- Karanlık tema varsayılan; aydınlık tema `:root`, karanlık `.dark` token'larıyla tanımlı (`globals.css`). Tema `<head>`'deki `THEME_INIT_SCRIPT` ile boyamadan önce uygulanır, tercih `localStorage`'da (`insitu-theme`).
- Karanlık: zemin `#0A0A0B`, kart `#111113`, vurgu zümrüt `#10B981`, ikincil gece mavisi `#3B82F6` / `#1E40AF`. Aydınlık: zemin `#FAFAFA`, kart `#FFFFFF`, zümrüt `#047857` (metin kontrastı için bir ton koyu).
- Çubuk grafikteki kategori adları (şehir, ürün…) içeriktir: `--foreground` ile tam kontrastlı yazılır, eksen sayıları soluk kalır. Renkler yalnızca `src/app/globals.css` token'larından (`--chart-1..5`, `--primary` …); bileşende hex yazma.
- Recharts her zaman shadcn `ChartContainer` + `chartConfig` ile sarılır.
- Bar = sıralama/karşılaştırma, Line = zaman trendi, Pie/Donut = parça-bütün (≤ 5 dilim + "Diğer").
- Erişilebilirlik: kontrast ≥ 4.5:1, görünür focus, ikon butonda `aria-label`, dokunma hedefi ≥ 44px, emoji ikon yok (Lucide), `prefers-reduced-motion`.
- Yeni UI öğesi gerekirse önce: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<konu>" --stack shadcn`.

## TypeScript (mastering-typescript)
- `tsconfig.json` katı: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. Bunları gevşetme.
- `any` yok; bilinmeyen veri `unknown` + Zod ile daraltılır.
- Tüm sınır verileri (HTTP gövdesi, DuckDB satırları, AI yanıtı) `src/lib/schema.ts`'teki Zod şemalarıyla doğrulanır; tipler `z.infer` ile türetilir.
- Başarı/hata akışı discriminated union ile (`{ ok: true, … } | { ok: false, error }`); beklenen hatalar için throw kullanma.
- Sabit kümeler için `as const` / `z.enum`, nesne literal doğrulaması için `satisfies`.

## Next.js App Router (nextjs-app-router-patterns)
- Varsayılan Server Component. `"use client"` yalnızca etkileşimli yapraklarda (dropzone, sorgu çubuğu, grafik, uygulama durumu).
- Kullanıcı verisine dokunan her kod (dosya okuma, DuckDB, içgörü, dışa aktarma) **yalnızca client**'ta çalışır.
- AI çağrısı yalnızca Route Handler'da (`src/app/api/translate/route.ts`); API anahtarları sunucu ortam değişkenlerinde kalır, asla `NEXT_PUBLIC_` önekiyle açılmaz.
- Route, IP başına dakikada 10 istekle sınırlıdır (`src/lib/rate-limit.ts`, bellek içi kayan pencere). Bir soru, onarım turuyla birlikte 2 istek harcayabilir.
- `"use client"` dosyalarından sunucu bileşenine sabit (string vb.) aktarma; istemci referansı olarak gelir. Paylaşılan sabitler `src/lib/` altında durur (örn. `theme.ts`).

## Dil desteği (tr / en)
- Kullanıcıya görünen **her** metin `src/lib/i18n.ts` içindedir; bileşenlerde sabit Türkçe/İngilizce metin yazma. `en` sözlüğü `Messages` (= `tr`'nin tipi) ile tiplenir, eksik anahtar derleme hatasıdır.
- Bileşenlerde `const { t, locale } = useI18n()`; saf fonksiyonlar (`formatValue`, `buildInsight`, `suggestQuestions`, `toCsv`) `locale` parametresi alır.
- Dil çerezde (`insitu-locale`); layout sunucuda okur, ilk ziyarette `Accept-Language`. Böylece ilk render doğru dilde gelir.
- İstekte `locale` gider; Gemini başlık/etiket/açıklamayı o dilde yazar. Veri değerleri (şehir, ürün adı) çevrilmez. Para birimi her iki dilde ₺.
- Motor içi teknik hata metinleri (guard, normalize) İngilizcedir; modele onarım için de gider.

## Gizlilik Sınırı (mimari kural — ihlal etme)
- Sunucuya giden **tek** payload `TranslateRequest`: `{ question, columns: [{ name, type }], repair? }`. Şema `z.strictObject` ile kilitli; satır/örnek veri alanı eklenmez.
- `history` (en fazla 3 tur, takip soruları için) yalnızca önceki **soru metni + SQL**'i taşır; önceki sonuçların değerleri, içgörüsü veya satırları asla eklenmez (`HistoryTurn` katı şema). Dosya değişince ve "Yeni konu" ile sıfırlanır.
- `repair` yalnızca üretilen SQL'i ve **yapısal** bir motor hatasını taşır (Binder/Parser/Catalog; tırnak içindeki değerler maskelenir). Veriye bağlı hatalar (Conversion, Out of Range…) asla gönderilmez — bkz. `repairableError` (`src/lib/engine/normalize.ts`).
- Sunucudan dönen tek şey `QueryPlan`. Sonuç satırları sunucuya geri gönderilmez.
- **İçgörü cümlesi yapay zekâya yazdırılmaz.** Model sonucu görmediği için yazacağı her sayı uydurma olur; içgörü `src/lib/insight.ts`'te gerçek sonuçtan hesaplanır.
- Üretilen SQL çalıştırılmadan önce `src/lib/engine/guard.ts`'ten geçer (tek `SELECT`/`WITH`; DDL, `COPY`, `ATTACH`, `read_*`, `INSTALL/LOAD` vb. reddedilir). Tablo yüklendikten sonra DuckDB'de dış erişim kapatılır.
- Tarayıcıda rastgele JS çalıştırılmaz; hesaplama motoru DuckDB-WASM + SQL'dir.

## Akış ve Klasör Yapısı
Deterministik: **Oku ➔ Çevir ➔ Çalıştır ➔ Çiz**. Tek istek, tek çevirmen; ajan zinciri yok.

```
src/
  app/
    layout.tsx, page.tsx        # Server; dark tema, Geist
    api/translate/route.ts      # POST → Zod doğrula → translator
  lib/
    schema.ts                   # Zod: TranslateRequest, QueryPlan, ResultRow
    translator/                 # QueryTranslator: gemini.ts (sistem prompt'u + şema), mock.ts (anahtarsız yedek)
    engine/                     # DuckDB-WASM, yükleme, temizleme (clean.ts), worker, SQL guard, normalize, sorgu
    result-view.ts              # Plan + satırlar → çizilebilir görünüm; tutarsızlıkta tabloya düşer
    format.ts                   # ₺, adet, %, Türkçe tarih/ay biçimleri (tek kaynak)
    insight.ts                  # Tek cümlelik içgörü, gerçek sonuçtan (client)
    export.ts                   # PNG + CSV (Türkçe Excel: ";" ve ondalık virgül)
  components/
    ui/                         # shadcn (elle düzenleme minimum)
    insitu-app.tsx              # client durum makinesi
    dropzone.tsx, ask-bar.tsx, result-bento.tsx, chart-view.tsx, metric-view.tsx, table-view.tsx
scripts/
  eval.mts, questions.txt       # Soru setini gerçek Gemini + DuckDB (Node) ile uçtan uca çalıştırır
```

### Yükleme ve temizleme
- Dosya `prepare.worker.ts`'te hazırlanır (Excel → CSV `xlsx-to-csv.ts` ile, saat diliminden bağımsız ISO tarihler; UTF-8 değilse Windows-1254 kabul edilip dönüştürülür). Ana thread'de dosya ayrıştırma **yapma**.
- DuckDB'ye tüm sütunlar `all_varchar` ile yüklenir; `clean.ts` tek profil sorgusuyla biçime karar verir. DuckDB'nin kendi tip tahminine güvenme: Türkçe "1.250" değerini 1,25 okur.
- Sütun yalnızca **her** değer aynı biçime uyuyorsa dönüştürülür; aksi hâlde metin kalır. Para/ondalık değerler `DECIMAL(38, ölçek)` olarak saklanır (DOUBLE toplamları kuruş kaydırır).
- Sonuç ana thread'e en fazla `MAX_RESULT_ROWS` (10.000) satır getirilir; fazlası `complete: false` olur ve kısmi veriden grafik/toplam üretilmez.

### QueryPlan sözleşmesi
`{ sql, chartType: "metric"|"bar"|"line"|"pie"|"table", xAxisKey, yAxisKey, seriesKey, title, columns: [{ key, label, format, total }] }`
- `columns` final SELECT'teki her sütunu tanımlar; `format` ∈ `currency | integer | number | percent (0–100) | text | date | month`. Sayıların nasıl görüneceğine yalnızca bu karar verir; bileşenlerde `toLocaleString` veya elle biçimlendirme yapma, `formatValue` kullan.
- `total`: sütunu satırlar boyunca toplamak anlamlı mı (tutar, adet evet; fiyat, ortalama, oran hayır). Tablo alt toplamı ve çubuk içgörüsündeki toplam yalnızca bunu kullanır; toplamlar `preciseSum` (`src/lib/math.ts`) ile yapılır.
- Model sorguya kendiliğinden `LIMIT` koymaz; büyük sonuçları istemci sınırlar ve kullanıcıya söyler.
- Grafik kuralları `result-view.ts`'te zorlanır: metric = tek satır; bar/line = sayısal y, tekrarsız x (çok seri için `seriesKey`, ≤ 8 seri); bar ≤ 30 kategori; pie = negatif olmayan ham değer, > 7 dilim "Diğer"de birleşir. Uymayan her sonuç yanlış bir grafik yerine **tabloya** düşer.
- Sistem prompt'unu değiştirdikten sonra `npm run eval` ile soru setini yeniden çalıştır ve çıktıları gözden geçir.

- Çevirmen: **Gemini** (`src/lib/translator/gemini.ts`; sırayla `gemini-flash-latest` → `gemini-flash-lite-latest` → `gemini-3.1-flash-lite`, kota/yoğunluk/zaman aşımında sıradakine geçer). Anahtar `.env.local` içinde `GEMINI_API_KEY` (git'e girmez). Anahtar yoksa kural tabanlı `mock.ts` devreye girer. Seçim `src/lib/translator/index.ts`'te; yeni sağlayıcı yalnızca `QueryTranslator` arayüzünü uygular ve girdi yine sadece sütun adları/tipleridir.

## Komutlar
- `npm run dev` — geliştirme sunucusu
- `npm run build` — üretim derlemesi
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest (biçimlendirme, temizleme — gerçek DuckDB ile, görünüm, içgörü, motor, guard, şema, mock)
- `npm run eval` — `scripts/questions.txt`'i örnek veri üzerinde uçtan uca çalıştırır (JSONL çıktı; `GEMINI_API_KEY` gerekir)
