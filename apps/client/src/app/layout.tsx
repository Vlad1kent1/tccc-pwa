import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { AppShell } from "@/components/app-shell";
import { StorageBootstrap } from "@/components/storage-bootstrap";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "TCCC Casualty Card",
  title: "TCCC Casualty Card",
  description: "Offline-first DD Form 1380 casualty records for field conditions",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TCCC",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c1210",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground" suppressHydrationWarning>
        <SerwistProvider
          swUrl="/serwist/sw.js"
          options={{ scope: "/", updateViaCache: "none" }}
        >
          <AppShell>
            <StorageBootstrap />
            {children}
          </AppShell>
        </SerwistProvider>
      </body>
    </html>
  );
}
