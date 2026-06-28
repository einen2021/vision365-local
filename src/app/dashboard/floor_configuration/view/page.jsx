"use client";

import { useState, useEffect, useCallback } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
import { MonitoringLiveStatus } from "@/components/monitoring-live-status";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  Building2,
  Loader2,
  Eye,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useToast } from "@/hooks/use-toast";
import { useAppData } from "@/hooks/useAppData";
import FirestoreService from "@/services/firestoreService";
import { CommunityBuildingSelect } from "@/components/floor-plan/community-building-select";
import { PlanImageCanvas } from "@/components/floor-plan/plan-image-canvas";
import { AssetControlModal } from "@/components/asset-control-modal";
import { FaqHelpButton } from "@/components/faq-help-button";
import { NAV_LEVELS, buildBreadcrumbs, buildBuildingFloorMarkers, filterPlacedNavMarkers } from "@/lib/nestedFloorPlan";
import { useFloorMapAssetStatusLive } from "@/hooks/useFloorMapAssetStatusLive";

const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((m) => ({ default: m.ModeToggle })),
  { ssr: false, loading: () => <div className="h-9 w-9" /> },
);

/**
 * Nested navigation viewer matching the hospital wireframe:
 * Building → Floor → Section → Subsection (assets).
 */
export default function ViewNestedFloorPlansPage() {
  const { toast } = useToast();
  const { communities, isLoadingCommunities, isReady, effectiveRole } = useAppData({
    toastOnCommunitiesError: true,
  });

  const [mounted, setMounted] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState("");
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState("");

  const [overview, setOverview] = useState(null);
  const [floors, setFloors] = useState([]);
  const [level, setLevel] = useState(NAV_LEVELS.BUILDING);
  const [floor, setFloor] = useState(null);
  const [section, setSection] = useState(null);
  const [subsection, setSubsection] = useState(null);
  const [assetMappings, setAssetMappings] = useState([]);
  const [sectionAssetMappings, setSectionAssetMappings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const assetStatusLive = useFloorMapAssetStatusLive(
    level === NAV_LEVELS.SUBSECTION || level === NAV_LEVELS.SECTION,
  );

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

  const resetNavigation = useCallback(() => {
    setLevel(NAV_LEVELS.BUILDING);
    setFloor(null);
    setSection(null);
    setSubsection(null);
    setAssetMappings([]);
  }, []);

  const loadBuildingData = useCallback(async () => {
    if (!selectedBuilding) return;
    setIsLoading(true);
    resetNavigation();
    try {
      const tree = await FirestoreService.getNestedFloorPlanTree(selectedBuilding);
      setOverview(tree.overview);
      setFloors(tree.floors);
      setLastUpdate(new Date());
    } catch (e) {
      console.error(e);
      toast({ title: "Load failed", description: e.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBuilding, resetNavigation, toast]);

  useEffect(() => {
    if (selectedBuilding) loadBuildingData();
    else {
      setOverview(null);
      setFloors([]);
      resetNavigation();
    }
  }, [selectedBuilding, loadBuildingData, resetNavigation]);

  const openFloor = async (f) => {
    const full = await FirestoreService.getNestedFloor(selectedBuilding, f.id);
    setFloor(full || f);
    setLevel(NAV_LEVELS.FLOOR);
    setSection(null);
    setSubsection(null);
  };

  const openSection = async (sectionId) => {
    const full = await FirestoreService.getNestedSection(
      selectedBuilding,
      floor.id,
      sectionId,
    );
    setSection(full);
    setSectionAssetMappings(full?.assetMappings || []);
    setLevel(NAV_LEVELS.SECTION);
    setSubsection(null);
    setAssetMappings([]);
  };

  const openSubsection = async (subsectionId) => {
    const full = await FirestoreService.getNestedSubsection(
      selectedBuilding,
      floor.id,
      section.id,
      subsectionId,
    );
    setSubsection(full);
    setAssetMappings(full?.assetMappings || []);
    setLevel(NAV_LEVELS.SUBSECTION);
  };

  const goBack = () => {
    if (level === NAV_LEVELS.SUBSECTION) {
      setLevel(NAV_LEVELS.SECTION);
      setSubsection(null);
      setAssetMappings([]);
    } else if (level === NAV_LEVELS.SECTION) {
      setLevel(NAV_LEVELS.FLOOR);
      setSection(null);
      setSectionAssetMappings([]);
    } else if (level === NAV_LEVELS.FLOOR) {
      setLevel(NAV_LEVELS.BUILDING);
      setFloor(null);
    }
  };

  const buildingName = selectedBuilding;
  const crumbs = buildBreadcrumbs(level, {
    buildingName,
    floor,
    section,
    subsection,
  });

  const floorList = overview?.floors?.length ? overview.floors : floors;

  if (!mounted) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4 md:px-8">
          <SidebarTrigger className="-ml-1" />
          <ClientModeToggle />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>View Floor Maps</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            {level !== NAV_LEVELS.BUILDING ? (
              <MonitoringLiveStatus lastUpdate={lastUpdate} />
            ) : null}
            <FirePanelStatusBadges />
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 pt-0">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Eye className="h-6 w-6" />
              Hospital Navigation
              <FaqHelpButton articleId="page-floor-view" size="md" />
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Building → floors → sections. Subsections are optional; assets can be placed on a section or inside a subsection.
            </p>
          </div>

          <CommunityBuildingSelect
            communities={communities}
            isLoadingCommunities={isLoadingCommunities}
            selectedCommunity={selectedCommunity}
            onCommunityChange={setSelectedCommunity}
            buildings={buildings}
            selectedBuilding={selectedBuilding}
            onBuildingChange={setSelectedBuilding}
            floorCount={floorList?.length}
          />

          {selectedBuilding ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {level !== NAV_LEVELS.BUILDING ? (
                      <Button variant="ghost" size="sm" onClick={goBack}>
                        <ArrowLeft className="mr-1 h-4 w-4" />
                        {crumbs.length > 1 ? `Back to ${crumbs[crumbs.length - 2].label}` : "Back"}
                      </Button>
                    ) : (
                      <>
                        <Building2 className="h-5 w-5" />
                        {selectedBuilding}
                      </>
                    )}
                  </CardTitle>
                  {level !== NAV_LEVELS.BUILDING ? (
                    <p className="text-sm text-muted-foreground mt-1">
                      {crumbs.map((c) => c.label).join(" → ")}
                    </p>
                  ) : null}
                </div>
                {level !== NAV_LEVELS.BUILDING ? (
                  <Badge variant="outline">Live</Badge>
                ) : null}
              </CardHeader>

              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : null}

                {!isLoading && level === NAV_LEVELS.BUILDING && (
                  <div className="space-y-4">
                    {floorList.length === 0 ? (
                      <Alert>
                        <AlertTitle>No floors configured</AlertTitle>
                        <AlertDescription>
                          Set up floors in Building Setup first.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <PlanImageCanvas
                        imageUrl={overview?.buildingImageUrl}
                        alt={selectedBuilding}
                        markers={buildBuildingFloorMarkers(floorList)}
                        mode="nav"
                        navMarkerStyle="floorButton"
                        maxHeight="min(75vh, 700px)"
                        onMarkerClick={(marker) => {
                          const floorData =
                            floors.find((x) => x.id === marker.floorId) ||
                            floorList.find((x) => x.id === marker.floorId);
                          if (floorData) openFloor(floorData);
                        }}
                      />
                    )}
                  </div>
                )}

                {!isLoading && level === NAV_LEVELS.FLOOR && floor && (
                  <PlanImageCanvas
                    imageUrl={floor.imageUrl}
                    alt={floor.name}
                    markers={filterPlacedNavMarkers(floor.sectionMarkers)}
                    mode="nav"
                    onMarkerClick={(m) => openSection(m.sectionId)}
                    maxHeight="min(75vh, 700px)"
                  />
                )}

                {!isLoading && level === NAV_LEVELS.SECTION && section && (
                  <PlanImageCanvas
                    imageUrl={section.imageUrl}
                    alt={section.name}
                    navMarkers={filterPlacedNavMarkers(section.subsectionMarkers)}
                    assetMarkers={sectionAssetMappings}
                    assetStatusLive={assetStatusLive}
                    onMarkerClick={(m) => openSubsection(m.subsectionId)}
                    onAssetClick={(mapping) => {
                      setSelectedAsset(mapping);
                      setIsAssetModalOpen(true);
                    }}
                    maxHeight="min(75vh, 700px)"
                  />
                )}

                {!isLoading && level === NAV_LEVELS.SUBSECTION && subsection && (
                  <PlanImageCanvas
                    imageUrl={subsection.imageUrl}
                    alt={subsection.name}
                    assetMarkers={assetMappings}
                    assetStatusLive={assetStatusLive}
                    onAssetClick={(mapping) => {
                      setSelectedAsset(mapping);
                      setIsAssetModalOpen(true);
                    }}
                    maxHeight="min(75vh, 700px)"
                  />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <AssetControlModal
          isOpen={isAssetModalOpen}
          onClose={() => setIsAssetModalOpen(false)}
          asset={selectedAsset}
          userRole={effectiveRole || ""}
          buildingName={selectedBuilding}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
