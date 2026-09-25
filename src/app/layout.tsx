import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/components/i18n-provider";
import { LOCALE_COOKIE, localeFromAcceptLanguage, messages, parseLocale, type Locale } from "@/lib/i18n";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

/** Cookie choice first; on a first visit, the browser's preferred language. */
async function currentLocale(): Promise<Locale> {
  const fromCookie = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return fromCookie ?? localeFromAcceptLanguage((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  const { meta } = messages[locale];
  return {
    metadataBase: new URL(SITE_URL),
    title: meta.title,
    description: meta.description,
    applicationName: SITE_NAME,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: SITE_NAME,
      title: meta.title,
      description: meta.description,
      locale: locale === "tr" ? "tr_TR" : "en_US",
      alternateLocale: locale === "tr" ? "en_US" : "tr_TR",
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
};

/** Tells Google the site's name ("Insitu") instead of letting it guess from the URL. */
function structuredData(description: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: SITE_NAME, alternateName: ["insitu.", "Insitu — Tablonla konuş"], url: SITE_URL },
      {
        "@type": "WebApplication",
        name: SITE_NAME,
        url: SITE_URL,
        description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Any (web browser)",
        inLanguage: ["tr", "en"],
        offers: { "@type": "Offer", price: "0", priceCurrency: "TRY" },
      },
    ],
  });
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await currentLocale();
  return (
    <html
      lang={locale}
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The init script may flip the theme class before hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          type="application/ld+json"
          // JSON.stringify output only; "<" is escaped so the data can never close the tag.
          dangerouslySetInnerHTML={{ __html: structuredData(messages[locale].meta.description).replace(/</g, "\\u003c") }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
