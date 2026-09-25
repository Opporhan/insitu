/**
 * Public origin of the site, for absolute URLs in metadata, robots and sitemap.
 * On Vercel this follows the production domain automatically (also after adding a custom domain).
 */
export const SITE_URL = process.env["VERCEL_PROJECT_PRODUCTION_URL"]
  ? `https://${process.env["VERCEL_PROJECT_PRODUCTION_URL"]}`
  : "http://localhost:3000"

export const SITE_NAME = "Insitu"
