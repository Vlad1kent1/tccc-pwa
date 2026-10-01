import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TCCC Casualty Card",
    short_name: "TCCC",
    description: "Offline-first DD Form 1380 casualty records for field conditions",
    start_url: "/",
    display: "standalone",
    background_color: "#0c1210",
    theme_color: "#0c1210",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/desktop.png",
        sizes: "1920x1080",
        type: "image/png",
        form_factor: "wide",
        label: "Casualty list on a desktop display",
      },
      {
        src: "/screenshots/mobile.png",
        sizes: "1170x2532",
        type: "image/png",
        form_factor: "narrow",
        label: "Casualty list on a phone",
      },
    ],
  };
}
