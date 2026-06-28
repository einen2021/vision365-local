"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Save,
  MapPin,
  Layers,
  Target,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FirestoreService from "@/services/firestoreService";
import { PlanImageCanvas } from "@/components/floor-plan/plan-image-canvas";
import { AssetPickerPanel } from "@/components/floor-plan/asset-picker-panel";
import {
  NAV_LEVELS,
  sanitizeFloorPlanId,
  createMarkerId,
  clickToNaturalCoords,
  buildBreadcrumbs,
  buildNestedPlacementContext,
  filterPlacedNavMarkers,
  findSectionMarker,
  findSubsectionMarker,
  isNavMarkerPlaced,
} from "@/lib/nestedFloorPlan";
import { db } from "@/config/firebase";
import { collection, getDocs } from "firebase/firestore";
import {
  pickMappingDeviceFields,
  buildingsMatch,
} from "@/lib/floorMapAssets";

/**
 * Multi-level editor: floor → section → subsection (with assets).
 */
export function NestedFloorPlanEditor({ buildingName }) {
  const { toast } = useToast();
  const [level, setLevel] = useState(NAV_LEVELS.BUILDING);
  const [floors, setFloors] = useState([]);
  const [floor, setFloor] = useState(null);
  const [sections, setSections] = useState([]);
  const [section, setSection] = useState(null);
  const [subsections, setSubsections] = useState([]);
  const [subsection, setSubsection] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields
  const [newFloorName, setNewFloorName] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [newSubsectionName, setNewSubsectionName] = useState("");
  const [placingMarker, setPlacingMarker] = useState(false);
  const [activeMarkerTarget, setActiveMarkerTarget] = useState(null);

  // Asset placement (section or subsection level)
  const [assetMappings, setAssetMappings] = useState([]);
  const [sectionAssetMappings, setSectionAssetMappings] = useState([]);
  const [assetMode, setAssetMode] = useState("general");
  const [generalAssets, setGeneralAssets] = useState([]);
  const [buildingAssets, setBuildingAssets] = useState([]);
  const [isLoadingGeneralAssets, setIsLoadingGeneralAssets] = useState(false);
  const [isLoadingBuildingAssets, setIsLoadingBuildingAssets] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [mappingCounter, setMappingCounter] = useState(0);
  const [floorToDelete, setFloorToDelete] = useState(null);
  const [isDeletingFloor, setIsDeletingFloor] = useState(false);

  const loadFloors = useCallback(async () => {
    if (!buildingName) return;
    setIsLoading(true);
    try {
      const list = await FirestoreService.getNestedFloors(buildingName);
      setFloors(list);
    } finally {
      setIsLoading(false);
    }
  }, [buildingName]);

  useEffect(() => {
    loadFloors();
    setLevel(NAV_LEVELS.BUILDING);
    setFloor(null);
    setSection(null);
    setSubsection(null);
  }, [buildingName, loadFloors]);

  const openFloor = async (f) => {
    const full = await FirestoreService.getNestedFloor(buildingName, f.id);
    setFloor(full || f);
    setLevel(NAV_LEVELS.FLOOR);
    const secs = await FirestoreService.getNestedSections(buildingName, f.id);
    setSections(secs);
    setSection(null);
    setSubsection(null);
  };

  const openSection = async (s) => {
    const full = await FirestoreService.getNestedSection(
      buildingName,
      floor.id,
      s.id,
    );
    setSection(full || s);
    setSectionAssetMappings(full?.assetMappings || []);
    setLevel(NAV_LEVELS.SECTION);
    const subs = await FirestoreService.getNestedSubsections(
      buildingName,
      floor.id,
      s.id,
    );
    setSubsections(subs);
    setSubsection(null);
    setAssetMappings([]);
    setSelectedAsset(null);
    setAssetSearch("");
  };

  const openSubsection = async (sub) => {
    const full = await FirestoreService.getNestedSubsection(
      buildingName,
      floor.id,
      section.id,
      sub.id,
    );
    setSubsection(full);
    setAssetMappings(full?.assetMappings || []);
    setLevel(NAV_LEVELS.SUBSECTION);
    setSelectedAsset(null);
    setAssetSearch("");
  };

  const goBack = async () => {
    if (level === NAV_LEVELS.SUBSECTION) {
      if (floor && section) {
        const refreshed = await FirestoreService.getNestedSection(
          buildingName,
          floor.id,
          section.id,
        );
        if (refreshed) {
          setSection(refreshed);
          setSectionAssetMappings(refreshed.assetMappings || []);
        }
      }
      setLevel(NAV_LEVELS.SECTION);
      setSubsection(null);
      setAssetMappings([]);
      setSelectedAsset(null);
    } else if (level === NAV_LEVELS.SECTION) {
      if (floor) {
        const refreshed = await FirestoreService.getNestedFloor(buildingName, floor.id);
        if (refreshed) setFloor(refreshed);
      }
      setLevel(NAV_LEVELS.FLOOR);
      setSection(null);
      setSectionAssetMappings([]);
      setSelectedAsset(null);
    } else if (level === NAV_LEVELS.FLOOR) {
      setLevel(NAV_LEVELS.BUILDING);
      setFloor(null);
    }
  };

  const uploadImage = async (file, type) => {
    if (!file) return;
    setIsSaving(true);
    try {
      if (type === "floor") {
        const url = await FirestoreService.uploadNestedFloorImage(
          buildingName,
          floor.id,
          file,
        );
        const refreshed = await FirestoreService.getNestedFloor(buildingName, floor.id);
        setFloor(refreshed || { ...floor, imageUrl: url });
        await loadFloors();
        toast({ title: "Floor image uploaded" });
      } else if (type === "section") {
        const url = await FirestoreService.uploadNestedSectionImage(
          buildingName,
          floor.id,
          section.id,
          file,
        );
        const refreshed = await FirestoreService.getNestedSection(
          buildingName,
          floor.id,
          section.id,
        );
        setSection(refreshed || { ...section, imageUrl: url });
        toast({ title: "Section image uploaded" });
      } else if (type === "subsection") {
        const url = await FirestoreService.uploadNestedSubsectionImage(
          buildingName,
          floor.id,
          section.id,
          subsection.id,
          file,
        );
        const refreshed = await FirestoreService.getNestedSubsection(
          buildingName,
          floor.id,
          section.id,
          subsection.id,
        );
        setSubsection(refreshed || { ...subsection, imageUrl: url });
        toast({ title: "Subsection image uploaded" });
      }
    } catch (e) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const addFloor = async () => {
    const name = newFloorName.trim();
    if (!name) return;
    if (floors.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast({
        title: "Duplicate",
        description: "A floor with this name already exists",
        variant: "destructive",
      });
      return;
    }

    const id = sanitizeFloorPlanId(name);
    if (floors.some((f) => f.id === id)) {
      toast({
        title: "Duplicate",
        description: "A floor with this id already exists",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const saved = await FirestoreService.saveNestedFloor(buildingName, {
        id,
        name,
        order: floors.length,
      });

      const overview = await FirestoreService.getBuildingOverview(buildingName);
      const existingFloors = overview?.floors || [];
      const alreadyInOverview = existingFloors.some((f) => f.id === saved.id);
      if (!alreadyInOverview) {
        await FirestoreService.saveBuildingOverview(buildingName, {
          buildingImageUrl: overview?.buildingImageUrl || "",
          floors: [
            ...existingFloors,
            { id: saved.id, name: saved.name, order: saved.order ?? floors.length },
          ],
        });
      }

      setFloors([...floors, saved]);
      setNewFloorName("");
      toast({ title: "Floor added", description: `"${name}" is ready to configure` });
    } catch (e) {
      toast({ title: "Failed to add floor", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const addSection = async () => {
    const name = newSectionName.trim();
    if (!name || !floor) return;
    const id = sanitizeFloorPlanId(name);
    const saved = await FirestoreService.saveNestedSection(buildingName, floor.id, {
      id,
      name,
    });
    setSections([...sections, saved]);
    const refreshed = await FirestoreService.getNestedFloor(buildingName, floor.id);
    setFloor(refreshed);
    setNewSectionName("");
    toast({ title: "Section added" });
  };

  const addSubsection = async () => {
    const name = newSubsectionName.trim();
    if (!name || !section) return;
    const id = sanitizeFloorPlanId(name);
    const saved = await FirestoreService.saveNestedSubsection(
      buildingName,
      floor.id,
      section.id,
      { id, name },
    );
    setSubsections([...subsections, saved]);
    const refreshed = await FirestoreService.getNestedSection(
      buildingName,
      floor.id,
      section.id,
    );
    setSection(refreshed);
    setNewSubsectionName("");
    toast({ title: "Subsection added" });
  };

  const handleDeleteSection = async (sectionId) => {
    if (!floor) return;
    try {
      await FirestoreService.deleteNestedSection(buildingName, floor.id, sectionId);
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
      const refreshed = await FirestoreService.getNestedFloor(buildingName, floor.id);
      setFloor(refreshed);
      await loadFloors();
      toast({ title: "Section deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteSubsection = async (subsectionId) => {
    if (!floor || !section) return;
    try {
      await FirestoreService.deleteNestedSubsection(
        buildingName,
        floor.id,
        section.id,
        subsectionId,
      );
      setSubsections((prev) => prev.filter((s) => s.id !== subsectionId));
      const refreshed = await FirestoreService.getNestedSection(
        buildingName,
        floor.id,
        section.id,
      );
      setSection(refreshed);
      toast({ title: "Subsection deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const startPlaceMarker = (target) => {
    setPlacingMarker(true);
    setActiveMarkerTarget(target);
    toast({
      title: "Place marker",
      description: `Click on the plan to place "${target.name}"`,
    });
  };

  const handleNavMarkerClick = async (event, imageRef, dims) => {
    if (!placingMarker || !activeMarkerTarget) return;
    const coords = clickToNaturalCoords(event, imageRef, dims);
    if (!coords) return;

    if (level === NAV_LEVELS.FLOOR) {
      const markers = [...(floor.sectionMarkers || [])];
      const idx = markers.findIndex((m) => m.sectionId === activeMarkerTarget.id);
      const entry = {
        id: markers[idx]?.id || createMarkerId(activeMarkerTarget.name),
        sectionId: activeMarkerTarget.id,
        name: activeMarkerTarget.name,
        ...coords,
      };
      if (idx >= 0) markers[idx] = entry;
      else markers.push(entry);
      await FirestoreService.updateFloorSectionMarkers(buildingName, floor.id, markers);
      setFloor({ ...floor, sectionMarkers: markers });
    } else if (level === NAV_LEVELS.SECTION) {
      const markers = [...(section.subsectionMarkers || [])];
      const idx = markers.findIndex((m) => m.subsectionId === activeMarkerTarget.id);
      const entry = {
        id: markers[idx]?.id || createMarkerId(activeMarkerTarget.name),
        subsectionId: activeMarkerTarget.id,
        name: activeMarkerTarget.name,
        ...coords,
      };
      if (idx >= 0) markers[idx] = entry;
      else markers.push(entry);
      await FirestoreService.updateSectionSubsectionMarkers(
        buildingName,
        floor.id,
        section.id,
        markers,
      );
      setSection({ ...section, subsectionMarkers: markers });
    }

    setPlacingMarker(false);
    setActiveMarkerTarget(null);
    toast({ title: "Marker placed" });
  };

  const loadGeneralAssets = async () => {
    if (!buildingName) return;
    setIsLoadingGeneralAssets(true);
    try {
      const snap = await getDocs(collection(db, "AssetsList"));
      const items = [];
      snap.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          assetsListId: d.id,
          name: data.itemType || data.assetName || data.description || d.id,
          category: data.system || data.category || "fire-life-safety",
          assetMode: "general",
          ...pickMappingDeviceFields(data),
        });
      });
      setGeneralAssets(items);
      toast({
        title: "General assets loaded",
        description: `${items.length} asset(s) for ${buildingName}`,
      });
    } catch (e) {
      toast({ title: "Load failed", description: e.message, variant: "destructive" });
    } finally {
      setIsLoadingGeneralAssets(false);
    }
  };

  const loadBuildingAssets = async () => {
    if (!buildingName) return;
    setIsLoadingBuildingAssets(true);
    try {
      const result = await FirestoreService.getBuildingAssets(buildingName);
      const items = [];
      Object.entries(result.categories || {}).forEach(([categoryKey, category]) => {
        Object.entries(category.assets || {}).forEach(([assetId, asset]) => {
          items.push({
            id: assetId,
            name: asset.assetName || asset.name || assetId,
            category: categoryKey,
            assetMode: "building",
            ...pickMappingDeviceFields(asset),
          });
        });
      });
      setBuildingAssets(items);
      toast({
        title: "Building assets loaded",
        description: `${items.length} asset(s) from ${buildingName}`,
      });
    } catch (e) {
      toast({ title: "Load failed", description: e.message, variant: "destructive" });
    } finally {
      setIsLoadingBuildingAssets(false);
    }
  };

  const handleAssetModeChange = (mode) => {
    setAssetMode(mode);
    setSelectedAsset(null);
  };

  const handleAssetPlace = (event, imageRef, dims) => {
    if (!selectedAsset) return;
    const coords = clickToNaturalCoords(event, imageRef, dims);
    if (!coords) return;

    const placementLevel =
      level === NAV_LEVELS.SUBSECTION ? "subsection" : "section";

    const placementContext = buildNestedPlacementContext({
      buildingName,
      floor,
      section,
      subsection: level === NAV_LEVELS.SUBSECTION ? subsection : null,
      placementLevel,
    });

    const mapping = {
      id: `asset_${mappingCounter}`,
      assetName: selectedAsset.name,
      category: selectedAsset.category,
      assetMode: selectedAsset.assetMode || assetMode,
      assetsListId:
        selectedAsset.assetMode === "general"
          ? selectedAsset.assetsListId || selectedAsset.id
          : null,
      buildingAssetId:
        selectedAsset.assetMode === "building" ? selectedAsset.id : null,
      ...coords,
      ...pickMappingDeviceFields(selectedAsset),
      ...placementContext,
      placedAt: new Date().toISOString(),
    };

    if (level === NAV_LEVELS.SECTION) {
      setSectionAssetMappings([...sectionAssetMappings, mapping]);
    } else if (level === NAV_LEVELS.SUBSECTION) {
      setAssetMappings([...assetMappings, mapping]);
    }

    setMappingCounter(mappingCounter + 1);
    setSelectedAsset(null);
  };

  const removeSectionAsset = (mappingId) => {
    setSectionAssetMappings((prev) => prev.filter((m) => m.id !== mappingId));
    setSelectedAsset(null);
    toast({
      title: "Marker removed",
      description: "Save section assets to persist changes.",
    });
  };

  const removeSubsectionAsset = (mappingId) => {
    setAssetMappings((prev) => prev.filter((m) => m.id !== mappingId));
    setSelectedAsset(null);
    toast({
      title: "Marker removed",
      description: "Save subsection assets to persist changes.",
    });
  };

  const saveSectionAssets = async () => {
    if (!section) return;
    setIsSaving(true);
    try {
      await FirestoreService.updateSectionAssetMappings(
        buildingName,
        floor.id,
        section.id,
        sectionAssetMappings,
      );
      toast({ title: "Section assets saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const saveSubsectionAssets = async () => {
    if (!subsection) return;
    setIsSaving(true);
    try {
      await FirestoreService.updateSubsectionAssetMappings(
        buildingName,
        floor.id,
        section.id,
        subsection.id,
        assetMappings,
      );
      toast({ title: "Assets saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const crumbs = buildBreadcrumbs(level, {
    buildingName,
    floor,
    section,
    subsection,
  });

  const handleDeleteFloor = async () => {
    if (!floorToDelete) return;
    setIsDeletingFloor(true);
    try {
      await FirestoreService.deleteNestedFloor(buildingName, floorToDelete.id);
      setFloors((prev) => prev.filter((f) => f.id !== floorToDelete.id));
      if (floor?.id === floorToDelete.id) {
        setFloor(null);
        setLevel(NAV_LEVELS.BUILDING);
        setSection(null);
        setSubsection(null);
      }
      toast({
        title: "Floor deleted",
        description: `"${floorToDelete.name}" and all its sections were removed.`,
      });
      setFloorToDelete(null);
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsDeletingFloor(false);
    }
  };

  if (!buildingName) {
    return (
      <Alert>
        <AlertTitle>Select a building</AlertTitle>
        <AlertDescription>Choose a community and building to edit floor maps.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {level !== NAV_LEVELS.BUILDING ? (
          <Button variant="outline" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-1 text-sm text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 ? " / " : ""}
              <span className={i === crumbs.length - 1 ? "text-foreground font-medium" : ""}>
                {c.label}
              </span>
            </span>
          ))}
        </div>
      </div>

      {level === NAV_LEVELS.BUILDING && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Select Floor to Configure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Ground Floor, Floor 1..."
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFloor()}
                disabled={isSaving}
              />
              <Button type="button" onClick={addFloor} disabled={isSaving || !newFloorName.trim()}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>

            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : floors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No floors yet. Enter a name above and click + to add one.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {floors.map((f) => (
                  <div
                    key={f.id}
                    className="relative flex flex-col items-center rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <button
                      type="button"
                      className="flex w-full flex-col items-center py-1"
                      onClick={() => openFloor(f)}
                    >
                      <MapPin className="mb-2 h-5 w-5 text-primary" />
                      <span className="font-medium text-center">{f.name}</span>
                      {f.imageUrl ? (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          Plan uploaded
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="mt-2 text-xs">
                          No plan image
                        </Badge>
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2 h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title={`Delete ${f.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFloorToDelete(f);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {level === NAV_LEVELS.FLOOR && floor && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>{floor.name} — Floor Plan</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setFloorToDelete(floor)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete Floor
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => uploadImage(e.target.files?.[0], "floor")}
              />
              <PlanImageCanvas
                imageUrl={floor.imageUrl}
                alt={floor.name}
                markers={filterPlacedNavMarkers(floor.sectionMarkers)}
                mode="nav"
                placingMarker={placingMarker}
                onImageClick={handleNavMarkerClick}
                onMarkerClick={(m) => {
                  const sec = sections.find((s) => s.id === m.sectionId);
                  if (sec) openSection(sec);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Section name"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                />
                <Button onClick={addSection}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {sections.map((s) => (
                <div key={s.id} className="flex flex-col gap-2 rounded border p-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      className="font-medium text-left hover:underline"
                      onClick={() => openSection(s)}
                    >
                      {s.name}
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteSection(s.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant={isNavMarkerPlaced(findSectionMarker(floor.sectionMarkers, s.id)) ? "secondary" : "outline"}
                    onClick={() => startPlaceMarker({ id: s.id, name: s.name })}
                  >
                    <Target className="mr-1 h-3 w-3" />
                    {isNavMarkerPlaced(findSectionMarker(floor.sectionMarkers, s.id))
                      ? "Reposition on map"
                      : "Place on map"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {level === NAV_LEVELS.SECTION && section && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{section.name} — Section Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Place assets directly on this section, or add optional subsections for a deeper room-level plan.
              </p>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => uploadImage(e.target.files?.[0], "section")}
              />
              <PlanImageCanvas
                imageUrl={section.imageUrl}
                alt={section.name}
                navMarkers={filterPlacedNavMarkers(section.subsectionMarkers)}
                assetMarkers={sectionAssetMappings}
                placingMarker={placingMarker || !!selectedAsset}
                onImageClick={(event, imageRef, dims) => {
                  if (placingMarker) handleNavMarkerClick(event, imageRef, dims);
                  else if (selectedAsset) handleAssetPlace(event, imageRef, dims);
                }}
                onMarkerClick={(m) => {
                  const sub = subsections.find((s) => s.id === m.subsectionId);
                  if (sub) openSubsection(sub);
                }}
                onAssetClick={(m) => {
                  if (!placingMarker && !selectedAsset) removeSectionAsset(m.id);
                }}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Subsections (optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Add subsections only if you need a separate room plan. Otherwise place assets below.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Room name"
                    value={newSubsectionName}
                    onChange={(e) => setNewSubsectionName(e.target.value)}
                  />
                  <Button onClick={addSubsection}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {subsections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No subsections added.</p>
                ) : (
                  subsections.map((sub) => (
                    <div key={sub.id} className="flex flex-col gap-2 rounded border p-2">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          className="font-medium text-left hover:underline"
                          onClick={() => openSubsection(sub)}
                        >
                          {sub.name}
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteSubsection(sub.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant={
                          isNavMarkerPlaced(
                            findSubsectionMarker(section.subsectionMarkers, sub.id),
                          )
                            ? "secondary"
                            : "outline"
                        }
                        onClick={() => startPlaceMarker({ id: sub.id, name: sub.name })}
                      >
                        <Target className="mr-1 h-3 w-3" />
                        {isNavMarkerPlaced(
                          findSubsectionMarker(section.subsectionMarkers, sub.id),
                        )
                          ? "Reposition on map"
                          : "Place on map"}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <AssetPickerPanel
                  title="Assets on Section"
                  assetMode={assetMode}
                  onAssetModeChange={handleAssetModeChange}
                  generalAssets={generalAssets}
                  buildingAssets={buildingAssets}
                  onLoadGeneral={loadGeneralAssets}
                  onLoadBuilding={loadBuildingAssets}
                  isLoadingGeneral={isLoadingGeneralAssets}
                  isLoadingBuilding={isLoadingBuildingAssets}
                  assetSearch={assetSearch}
                  onAssetSearchChange={setAssetSearch}
                  selectedAsset={selectedAsset}
                  onSelectAsset={setSelectedAsset}
                  onClearSelection={() => setSelectedAsset(null)}
                  placedCount={sectionAssetMappings.length}
                  placedMappings={sectionAssetMappings}
                  onRemovePlaced={removeSectionAsset}
                  onSave={saveSectionAssets}
                  isSaving={isSaving}
                  saveLabel="Save Section Assets"
                  buildingName={buildingName}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {level === NAV_LEVELS.SUBSECTION && subsection && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{subsection.name} — Subsection Plan (optional detail)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => uploadImage(e.target.files?.[0], "subsection")}
              />
              <PlanImageCanvas
                imageUrl={subsection.imageUrl}
                alt={subsection.name}
                assetMarkers={assetMappings}
                placingMarker={!!selectedAsset}
                onImageClick={handleAssetPlace}
                onAssetClick={(m) => {
                  if (!selectedAsset) removeSubsectionAsset(m.id);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <AssetPickerPanel
                title="Assets on Subsection"
                assetMode={assetMode}
                onAssetModeChange={handleAssetModeChange}
                generalAssets={generalAssets}
                buildingAssets={buildingAssets}
                onLoadGeneral={loadGeneralAssets}
                onLoadBuilding={loadBuildingAssets}
                isLoadingGeneral={isLoadingGeneralAssets}
                isLoadingBuilding={isLoadingBuildingAssets}
                assetSearch={assetSearch}
                onAssetSearchChange={setAssetSearch}
                selectedAsset={selectedAsset}
                onSelectAsset={setSelectedAsset}
                onClearSelection={() => setSelectedAsset(null)}
                  placedCount={assetMappings.length}
                  placedMappings={assetMappings}
                  onRemovePlaced={removeSubsectionAsset}
                  onSave={saveSubsectionAssets}
                  isSaving={isSaving}
                  saveLabel="Save Subsection Assets"
                buildingName={buildingName}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog
        open={Boolean(floorToDelete)}
        onOpenChange={(open) => {
          if (!open && !isDeletingFloor) setFloorToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete floor plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{floorToDelete?.name}&quot; including its
              plan image, all sections, subsections, and placed assets. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingFloor}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingFloor}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteFloor();
              }}
            >
              {isDeletingFloor ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete Floor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
