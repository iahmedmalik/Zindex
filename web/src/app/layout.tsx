import type { Metadata, Viewport } from "next";
import { Figtree, Outfit } from "next/font/google";
import { bootScript } from "@/lib/appearance";
import "./globals.css";
import "./app.css";

// Figtree for reading, Outfit for headings and figures; both are served from this app (no call to Google from the browser).
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-figtree", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Zindex", template: "%s · Zindex" },
  description: "Orders, invoices, stock and delivery cards for shops that sell on WhatsApp.",
  applicationName: "Zindex",
  appleWebApp: { capable: true, title: "Zindex", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1efed" },
    { media: "(prefers-color-scheme: dark)", color: "#161011" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${outfit.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before the first paint, so there is no flash of the wrong colours. */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
