import {
  AccountPanel,
  DevToolsPanel,
  Preferences,
  SettingsTitle,
  StorageStatusPanel,
  SyncPanel,
  UnitTokenPanel,
} from "./components";

export function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <SettingsTitle />
      <Preferences />
      <UnitTokenPanel />
      <SyncPanel />
      <AccountPanel />
      <StorageStatusPanel />
      {/* Opt-in so mock cards cannot reach a real deployment by a stray tap. */}
      {process.env.NEXT_PUBLIC_DEV_TOOLS === "true" ? <DevToolsPanel /> : null}
    </main>
  );
}
