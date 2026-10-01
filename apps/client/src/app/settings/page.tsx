import type { Metadata } from "next";
import { Preferences } from "@/components/preferences";
import { SyncPanel } from "@/components/sync-panel";
import { AccountPanel } from "./account-panel";
import { SettingsTitle } from "./settings-title";
import { DevToolsPanel } from "./dev-tools-panel";
import { StorageStatusPanel } from "./storage-status-panel";

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
