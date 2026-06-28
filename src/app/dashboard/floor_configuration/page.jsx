"use client";

import { useState, useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  Layers,
  ImageIcon,
  Target,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { useAppData } from "@/hooks/useAppData";
import FirestoreService from "@/services/firestoreService";
import { CommunityBuildingSelect } from "@/components/floor-plan/community-building-select";
import { FaqHelpButton } from "@/components/faq-help-button";
import { sanitizeFloorPlanId, clickToNaturalCoords, buildBuildingFloorMarkers } from "@/lib/nestedFloorPlan";
import { PlanImageCanvas } from "@/components/floor-plan/plan-image-canvas";

const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((m) => ({ default: m.ModeToggle })),
  { ssr: false, loading: () => <div className="h-9 w-9" /> },
);

/**
 * Step 1: Upload building image and define all floors for the building.
 * Floors become navigation buttons on the building overview screen.
 */
export default function BuildingOverviewSetupPage() {
  const { toast } = useToast();
  const { communities, isLoadingCommunities, isReady } = useAppData({
    toastOnCommunitiesError: true,
  });

  const [mounted, setMounted] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState("");
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [buildingImageUrl, setBuildingImageUrl] = useState("");
  const [floors, setFloors] = useState([]);
  const [newFloorName, setNewFloorName] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [placingFloor, setPlacingFloor] = useState(null);

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

  useEffect(() => {
    if (!selectedBuilding) {
      setBuildingImageUrl("");
      setFloors([]);
      setImagePreview("");
      return;
    }
    loadOverview();
  }, [selectedBuilding]);

  const loadOverview = async () => {
    setIsLoading(true);
    try {
      const overview = await FirestoreService.getBuildingOverview(selectedBuilding);
      if (overview) {
        setBuildingImageUrl(overview.buildingImageUrl || "");
        setImagePreview(overview.buildingImageUrl || "");
        setFloors(overview.floors || []);
      } else {
        setBuildingImageUrl("");
        setImagePreview("");
        setFloors([]);
      }
    } catch (e) {
      console.error(e);
      toast({ title: "Error", description: "Failed to load building overview", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image", variant: "destructive" });
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result || "");
    reader.readAsDataURL(file);
  };

  const addFloor = () => {
    const name = newFloorName.trim();
    if (!name) return;
    if (floors.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Duplicate", description: "Floor name already exists", variant: "destructive" });
      return;
    }
    setFloors([
      ...floors,
      { id: sanitizeFloorPlanId(name), name, order: floors.length },
    ]);
    setNewFloorName("");
  };

  const removeFloor = (id) => {
    setFloors(floors.filter((f) => f.id !== id).map((f, i) => ({ ...f, order: i })));
    if (placingFloor?.id === id) setPlacingFloor(null);
  };

  const startPlaceFloor = (floor) => {
    setPlacingFloor(floor);
    toast({
      title: "Place floor button",
      description: `Click on the building image to place "${floor.name}"`,
    });
  };

  const handleBuildingImageClick = (event, imageRef, dims) => {
    if (!placingFloor) return;
    const coords = clickToNaturalCoords(event, imageRef, dims);
    if (!coords) return;

    setFloors((prev) =>
      prev.map((f) =>
        f.id === placingFloor.id ? { ...f, ...coords } : f,
      ),
    );
    setPlacingFloor(null);
    toast({ title: "Floor placed", description: `"${placingFloor.name}" positioned on building` });
  };

  const handleSave = async () => {
    if (!selectedBuilding) {
      toast({ title: "Select building", variant: "destructive" });
      return;
    }
    if (floors.length === 0) {
      toast({ title: "Add floors", description: "Add at least one floor", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      let imageUrl = buildingImageUrl;
      if (selectedImage) {
        imageUrl = await FirestoreService.uploadBuildingOverviewImage(
          selectedBuilding,
          selectedImage,
        );
        setBuildingImageUrl(imageUrl);
        setSelectedImage(null);
      }

      await FirestoreService.saveBuildingOverview(selectedBuilding, {
        buildingImageUrl: imageUrl,
        floors,
      });

      // Create empty floor documents for each floor
      for (const floor of floors) {
        await FirestoreService.saveNestedFloor(selectedBuilding, floor);
      }

      toast({
        title: "Saved",
        description: "Building overview saved. Continue in Edit Floor Maps to configure each floor.",
      });
    } catch (e) {
      console.error(e);
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) return null;

  const canvasImageUrl = selectedImage
    ? imagePreview
    : buildingImageUrl || imagePreview;

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
                <BreadcrumbPage>Building Overview Setup</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto">
            <FirePanelStatusBadges />
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 pt-0">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              Step 1: Building & Floors
              <FaqHelpButton articleId="page-floor-config" size="md" />
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Upload the building image, add floors, and place each floor button on the building image.
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
            floorCount={floors.length}
          />

          {selectedBuilding ? (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <ImageIcon className="h-5 w-5" />
                      Building Image & Floor Buttons
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Input type="file" accept="image/*" onChange={handleImageUpload} />
                    {placingFloor ? (
                      <p className="text-sm text-primary font-medium">
                        Click the building image to place: {placingFloor.name}
                      </p>
                    ) : null}
                    <PlanImageCanvas
                      imageUrl={canvasImageUrl}
                      alt="Building"
                      markers={buildBuildingFloorMarkers(floors)}
                      mode="nav"
                      navMarkerStyle="floorButton"
                      placingMarker={Boolean(placingFloor)}
                      onImageClick={handleBuildingImageClick}
                      maxHeight="min(70vh, 560px)"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Layers className="h-5 w-5" />
                      Floors
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. Ground Floor, Floor 1..."
                        value={newFloorName}
                        onChange={(e) => setNewFloorName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addFloor()}
                      />
                      <Button type="button" onClick={addFloor}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>

                    {isLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                      </div>
                    ) : floors.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No floors added yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {floors.map((floor) => (
                          <li
                            key={floor.id}
                            className="flex flex-col gap-2 rounded border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="font-medium">{floor.name}</span>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canvasImageUrl}
                                onClick={() => startPlaceFloor(floor)}
                              >
                                <Target className="mr-1 h-3 w-3" />
                                Place on image
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeFloor(floor.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={handleSave} disabled={isSaving || floors.length === 0}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Building Overview
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/dashboard/floor_configuration/edit">
                    Continue to Edit Floor Maps →
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
