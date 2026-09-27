import type { MetadataRoute } from "next"
import { messages } from "@/lib/i18n"

/** Installable app (home screen / desktop); with the service worker it opens offline too. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: messages.tr.meta.title,
    short_name: "Insitu",
    description: messages.tr.meta.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    lang: "tr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
