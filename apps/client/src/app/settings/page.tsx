import type { Metadata } from "next";
import { SettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Settings · TCCC Casualty Card",
};

export default function SettingsRoute() {
  return <SettingsPage />;
}
