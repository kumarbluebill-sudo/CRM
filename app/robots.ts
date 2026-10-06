import type { MetadataRoute } from "next";

// CRM pages are private; only the future public marketing pages should be indexable.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/$", disallow: "/" }] };
}
