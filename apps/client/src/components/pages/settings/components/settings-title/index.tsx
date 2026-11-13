"use client";

import { useT } from "@/i18n/use-t";

export function SettingsTitle() {
  const { t } = useT();
  return <h1 className="text-2xl font-semibold">{t("nav.settings")}</h1>;
}
