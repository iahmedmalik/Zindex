import type { MetadataRoute } from "next";

// Makes Zindex installable from the phone's browser ("Add to Home screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zindex",
    short_name: "Zindex",
    description: "Orders, invoices, stock and delivery cards for shops that sell on WhatsApp.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1ede8",
    theme_color: "#5d1b23",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
