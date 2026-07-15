"use client";

import { LivePanelListPage } from "@/components/live-panel-list-page";

export default function LiveTroublePage() {
  return (
    <LivePanelListPage
      label="Trouble"
      title="Live Trouble"
      description="Latest trouble list from the fire panel"
      tone="trouble"
    />
  );
}
