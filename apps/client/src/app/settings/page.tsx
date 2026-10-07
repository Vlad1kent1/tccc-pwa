import type { Metadata } from "next";
import { Preferences } from "@/components/pages/settings/preferences";
import { SyncPanel } from "@/components/pages/settings/sync-panel";
import { AccountPanel } from "@/components/pages/settings/account-panel";
import { SettingsTitle } from "@/components/pages/settings/settings-title";
import { DevToolsPanel } from "@/components/pages/settings/dev-tools-panel";
import { StorageStatusPanel } from "@/components/pages/settings/storage-status-panel";

export const metadata: Metadata = {
  title: "Settings · TCCC Casualty Card",
};

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <SettingsTitle />
      <Preferences />
      <SyncPanel />
      <AccountPanel />
      <StorageStatusPanel />
      <DevToolsPanel />
    </main>
  );
}
