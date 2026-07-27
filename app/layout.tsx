import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const baseUrl = host
    ? new URL(`${protocol}://${host}`)
    : new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

  return {
    metadataBase: baseUrl,
    title: "EventClear — Provable collateral compression",
    description:
      "Unlock guaranteed terminal value from formally related Polymarket positions.",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "EventClear — Provable collateral compression",
      description: "Unlock guaranteed value before markets resolve.",
      images: [{ url: new URL("/og.png", baseUrl), width: 1729, height: 910, alt: "EventClear provable collateral compression payoff structure" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "EventClear — Provable collateral compression",
      description: "Unlock guaranteed value before markets resolve.",
      images: [new URL("/og.png", baseUrl)],
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
