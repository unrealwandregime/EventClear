import type { MetadataRoute } from "next";

const SITE_URL = "https://eventclear-protocol.thecryptotom.chatgpt.site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date("2026-09-05T00:00:00.000Z"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/app`,
      lastModified: new Date("2026-09-05T00:00:00.000Z"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
