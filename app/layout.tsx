import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "EventClear — Provable collateral compression",
  description:
    "Unlock guaranteed terminal value from formally related Polymarket positions.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "EventClear — Provable collateral compression",
    description: "Unlock guaranteed value before markets resolve.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "EventClear payoff structure" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EventClear — Provable collateral compression",
    description: "Unlock guaranteed value before markets resolve.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
