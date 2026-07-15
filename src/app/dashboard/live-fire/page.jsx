"use client";

import { LivePanelListPage } from "@/components/live-panel-list-page";

export default function LiveFirePage() {
  return (
    <LivePanelListPage
      label="Fire"
      title="Live Fire"
      description="Latest fire alarm list from the fire panel"
      tone="fire"
    />
  );
}
