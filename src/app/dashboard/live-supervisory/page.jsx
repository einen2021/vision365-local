"use client";

import { LivePanelListPage } from "@/components/live-panel-list-page";

export default function LiveSupervisoryPage() {
  return (
    <LivePanelListPage
      label="Supervisory"
      title="Live Supervisory"
      description="Latest supervisory list from the fire panel"
      tone="supervisory"
    />
  );
}
