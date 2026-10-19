"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/use-t";
import { useSyncStatus } from "@/lib/sync";

/** Shown on every screen while sync is paused for the unit token, so queued cards are not silently stuck. */
export function AuthBanner() {
  const { t } = useT();
  const { authProblem } = useSyncStatus();
  const pathname = usePathname();
  if (!authProblem) return null;

  return (
    <div data-print-hide role="alert" className="banner-warning">
      <p className="text-sm font-medium">{t(authProblem === "rejected" ? "unitToken.rejected" : "unitToken.missing")}</p>
      {pathname === "/settings" ? null : (
        <Link href="/settings#unit-token" className="btn btn-secondary shrink-0">
          {t("unitToken.fix")}
        </Link>
      )}
    </div>
  );
}
