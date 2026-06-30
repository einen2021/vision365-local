"use client";

import { useState, useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/hooks/useAppData";
import { CommunityBuildingSelect } from "@/components/floor-plan/community-building-select";
import { NestedFloorPlanEditor } from "@/components/floor-plan/nested-floor-plan-editor";
import { FaqHelpButton } from "@/components/faq-help-button";

const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((m) => ({ default: m.ModeToggle })),
  { ssr: false, loading: () => <div className="h-9 w-9" /> },
);

/** Steps 2–4: configure floor plans, sections, subsections, and assets. */
export default function EditFloorPlansPage() {
  const { communities, isLoadingCommunities, isReady } = useAppData({
    toastOnCommunitiesError: true,
  });
  const [mounted, setMounted] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState("");
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isReady || communities.length === 0 || selectedCommunity) return;
    setSelectedCommunity(communities[0].id);
  }, [isReady, communities, selectedCommunity]);

  useEffect(() => {
    if (!selectedCommunity) {
      setBuildings([]);
      setSelectedBuilding("");
      return;
    }
    const community = communities.find((c) => c.id === selectedCommunity);
    setBuildings(community?.buildings || []);
    setSelectedBuilding("");
  }, [selectedCommunity, communities]);

  if (!mounted) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex min-h-16 shrink-0 items-center gap-3 py-2 px-4 md:px-8">
          <SidebarTrigger className="-ml-1" />
          <ClientModeToggle />
          <div className="ml-auto">
            <FirePanelStatusBadges />
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 pt-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                Edit Nested Floor Maps
                <FaqHelpButton articleId="page-floor-edit" size="md" />
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Configure each floor plan, mark sections, optionally add subsections, and place assets on sections or subsections.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/dashboard/floor_configuration">← Building Setup</Link>
            </Button>
          </div>

          <CommunityBuildingSelect
            communities={communities}
            isLoadingCommunities={isLoadingCommunities}
            selectedCommunity={selectedCommunity}
            onCommunityChange={setSelectedCommunity}
            buildings={buildings}
            selectedBuilding={selectedBuilding}
            onBuildingChange={setSelectedBuilding}
          />

          <NestedFloorPlanEditor buildingName={selectedBuilding} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
