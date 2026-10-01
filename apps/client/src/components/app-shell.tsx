"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { loadStoredLocale } from "@/i18n/locale";
import { useT } from "@/i18n/use-t";
import { loadStoredTheme } from "@/lib/theme";
import { ConnectivityIndicator } from "./connectivity-indicator";
import { PersistenceBanner } from "./persistence-banner";
import { SyncToast, ToastViewport } from "./toast-viewport";
import { UpdateBanner } from "./update-banner";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();
  const atHome = pathname === "/";

  useEffect(() => {
    loadStoredLocale();
    loadStoredTheme();
  }, []);

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <UpdateBanner />
      <PersistenceBanner />
      <header data-print-hide className="sticky top-0 z-40 shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          {atHome ? (
            <Link href="/" className="min-w-0 truncate text-lg font-semibold tracking-tight">
              {t("app.title")}
            </Link>
          ) : (
            <Link href="/" aria-label={t("nav.back")} className="btn btn-icon btn-secondary shrink-0">
              <BackIcon />
            </Link>
          )}
          <div className="flex items-center gap-2">
            <ConnectivityIndicator />
            {atHome ? (
              <Link href="/settings" aria-label={t("nav.settings")} className="btn btn-icon btn-secondary">
                <SettingsIcon />
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <div className="relative z-0 flex flex-1 flex-col pointer-events-auto">{children}</div>
      <ToastViewport />
      <SyncToast />
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
