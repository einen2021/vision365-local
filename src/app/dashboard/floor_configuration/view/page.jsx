"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar, DashboardPageContent } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
import { useToast } from "@/hooks/use-toast";
import { useAppData } from "@/hooks/useAppData";
import FirestoreService from "@/services/firestoreService";
import { CommunityBuildingSelect } from "@/components/floor-plan/community-building-select";
import { PlanImageCanvas } from "@/components/floor-plan/plan-image-canvas";
import { DeviceIconsGuide } from "@/components/floor-plan/device-icons-guide";
import { AssetTypeIconSettings } from "@/components/floor-plan/asset-type-icon-settings";
import { normalizeAssetTypeKey } from "@/lib/assetIcons";
import { AssetControlModal } from "@/components/asset-control-modal";
import { FaqHelpButton } from "@/components/faq-help-button";
import { FloorPlanPlacementCsvActions } from "@/components/floor-plan/floor-plan-placement-csv-actions";
import { NAV_LEVELS, buildBreadcrumbs, buildBuildingFloorMarkers, filterPlacedNavMarkers } from "@/lib/nestedFloorPlan";
import { normalizeBuildingName } from "@/lib/buildingNames";
import {
  findCommunityIdForBuilding,
  parseFloorPlanViewSearchParams,
} from "@/lib/fireAlertFloorNavigation";
import { useFloorMapAssetStatusLive } from "@/hooks/useFloorMapAssetStatusLive";
import { prefetchPlanImageUrls } from "@/lib/prefetchPlanImage";
import {
  parseGraphicsViewSelectionParams,
  saveGraphicsViewSelection,
  resolveGraphicsViewSelection,
  buildingExistsInCommunities,
  findBuildingListValue,
  resolveSelectionForCommunity,
} from "@/lib/graphicsViewSelection";
import {
  collectAssetHighlightKeys,
  enrichAssetMappingsFromAssetsList,
  findHighlightMappingAsync,
  resolveMappingDeviceFields,
} from "@/lib/floorMapAssets";
import { db } from "@/config/firebase";

/**
 * Nested navigation viewer matching the hospital wireframe:
 * Building → Floor → Section → Subsection (assets).
 */
export default function ViewNestedFloorPlansPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const deepLinkRef = useRef(null);
  const deepLinkAppliedRef = useRef(false);
  const navRequestRef = useRef(0);
  const subsectionCacheRef = useRef(new Map());
  const selectionInitializedRef = useRef(false);
  const { communities, isLoadingCommunities, isReady, effectiveRole, allBuildings, selectedCommunity: globalCommunity, selectedBuilding: globalBuilding, setSelectedCommunity: setGlobalCommunity, setSelectedBuilding: setGlobalBuilding } = useAppData({
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
  const [subsections, setSubsections] = useState([]);
  const [assetMappings, setAssetMappings] = useState([]);
  const [sectionAssetMappings, setSectionAssetMappings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [planImageLoaded, setPlanImageLoaded] = useState(false);
  // Temporary map highlight after asset search / deep-link navigation.
  // Use many keys (id, assetsListId, address) so markers still match.
  const [highlightedAssetKeys, setHighlightedAssetKeys] = useState([]);
  const highlightTimerRef = useRef(null);

  const assetStatusLive = useFloorMapAssetStatusLive(planImageLoaded);

  useEffect(() => setMounted(true), []);

  // Clear search highlight timer when leaving the page.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

  /** Show a large orange outline on the matched marker for several seconds. */
  const startAssetHighlight = useCallback((keys) => {
    const list = (Array.isArray(keys) ? keys : [keys])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    if (!list.length) return;

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    setHighlightedAssetKeys(list);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedAssetKeys([]);
      highlightTimerRef.current = null;
    }, 10000);
  }, []);

  // Attach AssetsList deviceAddress / assetsListId so F/T marker colors can match.
  const applySectionMappings = useCallback(async (mappings) => {
    const list = Array.isArray(mappings) ? mappings : [];
    setSectionAssetMappings(list);
    const enriched = await enrichAssetMappingsFromAssetsList(db, list);
    setSectionAssetMappings(enriched);
    return enriched;
  }, []);

  const applyAssetMappings = useCallback(async (mappings) => {
    const list = Array.isArray(mappings) ? mappings : [];
    setAssetMappings(list);
    const enriched = await enrichAssetMappingsFromAssetsList(db, list);
    setAssetMappings(enriched);
    return enriched;
  }, []);

  // One-shot enrichment for the already-open plan so F/T colors can match addresses.
  useEffect(() => {
    if (!planImageLoaded) return;

    let cancelled = false;
    void (async () => {
      if (level === NAV_LEVELS.SECTION && sectionAssetMappings.length > 0) {
        const needs = sectionAssetMappings.some(
          (mapping) => !resolveMappingDeviceFields(mapping).deviceAddress,
        );
        if (!needs || cancelled) return;
        const enriched = await enrichAssetMappingsFromAssetsList(
          db,
          sectionAssetMappings,
        );
        if (!cancelled) setSectionAssetMappings(enriched);
      }
      if (level === NAV_LEVELS.SUBSECTION && assetMappings.length > 0) {
        const needs = assetMappings.some(
          (mapping) => !resolveMappingDeviceFields(mapping).deviceAddress,
        );
        if (!needs || cancelled) return;
        const enriched = await enrichAssetMappingsFromAssetsList(db, assetMappings);
        if (!cancelled) setAssetMappings(enriched);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-run when the plan becomes ready or the nav level changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planImageLoaded, level, section?.id, subsection?.id]);

  useEffect(() => {
    if (!isReady || communities.length === 0 || selectionInitializedRef.current) return;

    const fromUrl = parseGraphicsViewSelectionParams(searchParams);
    const fromGlobal =
      globalBuilding && buildingExistsInCommunities(communities, globalBuilding)
        ? {
            building: globalBuilding,
            communityId: globalCommunity || findCommunityIdForBuilding(communities, globalBuilding),
          }
        : null;
    const resolved =
      (fromUrl?.building
        ? resolveSelectionForCommunity(
            communities,
            fromUrl.communityId || findCommunityIdForBuilding(communities, fromUrl.building),
            fromUrl.building,
          )
        : null) ||
      (fromGlobal
        ? resolveSelectionForCommunity(
            communities,
            fromGlobal.communityId,
            fromGlobal.building,
          )
        : null) ||
      resolveGraphicsViewSelection({
        communities,
        selectedCommunity: globalCommunity || "",
        selectedBuilding: globalBuilding || "",
        allBuildings,
      });

    if (resolved?.communityId && resolved?.building) {
      const community = communities.find((c) => c.id === resolved.communityId);
      setBuildings(community?.buildings || []);
      setSelectedCommunity(resolved.communityId);
      setSelectedBuilding(resolved.building);
      setGlobalCommunity(resolved.communityId);
      setGlobalBuilding(resolved.building);
      saveGraphicsViewSelection({
        communityId: resolved.communityId,
        building: resolved.building,
      });
    } else if (communities[0]?.id) {
      const fallback = resolveSelectionForCommunity(communities, communities[0].id);
      if (fallback) {
        const community = communities.find((c) => c.id === fallback.communityId);
        setBuildings(community?.buildings || []);
        setSelectedCommunity(fallback.communityId);
        setSelectedBuilding(fallback.building);
        setGlobalCommunity(fallback.communityId);
        setGlobalBuilding(fallback.building);
        saveGraphicsViewSelection(fallback);
      } else {
        setSelectedCommunity(communities[0].id);
      }
    }

    selectionInitializedRef.current = true;
  }, [
    allBuildings,
    communities,
    globalBuilding,
    globalCommunity,
    isReady,
    searchParams,
    setGlobalBuilding,
    setGlobalCommunity,
  ]);

  useEffect(() => {
    if (!selectedCommunity) {
      setBuildings([]);
      setSelectedBuilding("");
      return;
    }
    const community = communities.find((c) => c.id === selectedCommunity);
    const nextBuildings = community?.buildings || [];
    setBuildings(nextBuildings);
    setSelectedBuilding((prev) => {
      const matched = findBuildingListValue(nextBuildings, prev);
      if (matched) return matched;
      if (nextBuildings.length === 1) {
        return findBuildingListValue(nextBuildings, nextBuildings[0]);
      }
      return "";
    });
  }, [selectedCommunity, communities]);

  const handleCommunityChange = useCallback(
    (communityId) => {
      setSelectedCommunity(communityId);
      setGlobalCommunity(communityId);
    },
    [setGlobalCommunity],
  );

  const handleBuildingChange = useCallback(
    (buildingName) => {
      setSelectedBuilding(buildingName);
      setGlobalBuilding(buildingName);
      if (buildingName && selectedCommunity) {
        saveGraphicsViewSelection({
          communityId: selectedCommunity,
          building: buildingName,
        });
      }
    },
    [selectedCommunity, setGlobalBuilding],
  );

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
    setSubsections([]);
    subsectionCacheRef.current.clear();
  };

  const prefetchSubsection = useCallback(
    async (subsectionId, sectionId = section?.id) => {
      if (!selectedBuilding || !floor?.id || !sectionId || !subsectionId) return;
      if (subsectionCacheRef.current.has(subsectionId)) return;

      try {
        const full = await FirestoreService.getNestedSubsection(
          selectedBuilding,
          floor.id,
          sectionId,
          subsectionId,
        );
        if (!full) return;
        subsectionCacheRef.current.set(subsectionId, full);
        if (full.imageUrl) {
          void prefetchPlanImageUrls([full.imageUrl]);
        }
      } catch (error) {
        console.warn("Subsection prefetch failed:", error);
      }
    },
    [selectedBuilding, floor?.id, section?.id],
  );

  const openSection = async (sectionId) => {
    const requestId = ++navRequestRef.current;
    setPlanImageLoaded(false);
    setIsNavigating(true);
    subsectionCacheRef.current.clear();
    try {
      const [full, subs] = await Promise.all([
        FirestoreService.getNestedSection(selectedBuilding, floor.id, sectionId),
        FirestoreService.getNestedSubsections(selectedBuilding, floor.id, sectionId),
      ]);
      if (requestId !== navRequestRef.current) return;
      setSection(full);
      await applySectionMappings(full?.assetMappings || []);
      setSubsections(subs);
      setLevel(NAV_LEVELS.SECTION);
      setSubsection(null);
      setAssetMappings([]);
      void prefetchPlanImageUrls(subs.map((sub) => sub.imageUrl));
      subs.forEach((sub) => {
        void prefetchSubsection(sub.id, sectionId);
      });
    } finally {
      if (requestId === navRequestRef.current) setIsNavigating(false);
    }
  };

  const openSubsection = async (subsectionId) => {
    const requestId = ++navRequestRef.current;
    setPlanImageLoaded(false);

    const cached = subsectionCacheRef.current.get(subsectionId);
    if (cached) {
      setSubsection(cached);
      void applyAssetMappings(cached.assetMappings || []);
      setLevel(NAV_LEVELS.SUBSECTION);
      return;
    }

    const basic = subsections.find((sub) => sub.id === subsectionId);
    if (basic) {
      setSubsection(basic);
      setAssetMappings([]);
      setLevel(NAV_LEVELS.SUBSECTION);
    } else {
      setIsNavigating(true);
    }

    try {
      const full = await FirestoreService.getNestedSubsection(
        selectedBuilding,
        floor.id,
        section.id,
        subsectionId,
      );
      if (requestId !== navRequestRef.current) return;
      if (full) {
        subsectionCacheRef.current.set(subsectionId, full);
        setSubsection(full);
        await applyAssetMappings(full.assetMappings || []);
        setLevel(NAV_LEVELS.SUBSECTION);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "Could not open subsection",
        description: error?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      if (requestId === navRequestRef.current) setIsNavigating(false);
    }
  };

  const applyNestedDeepLink = useCallback(
    async ({ floorId, sectionId, subsectionId, assetId, address, highlight }) => {
      if (!selectedBuilding || !floorId || !sectionId) return;

      const requestId = ++navRequestRef.current;

      const [fullFloor, fullSection, subs] = await Promise.all([
        FirestoreService.getNestedFloor(selectedBuilding, floorId),
        FirestoreService.getNestedSection(selectedBuilding, floorId, sectionId),
        FirestoreService.getNestedSubsections(selectedBuilding, floorId, sectionId),
      ]);
      if (requestId !== navRequestRef.current || !fullFloor || !fullSection) return;

      setFloor(fullFloor);
      setSection(fullSection);
      let mappings = await applySectionMappings(fullSection?.assetMappings || []);
      setSubsections(subs);
      void prefetchPlanImageUrls(subs.map((sub) => sub.imageUrl));

      if (subsectionId) {
        const fullSubsection = await FirestoreService.getNestedSubsection(
          selectedBuilding,
          floorId,
          sectionId,
          subsectionId,
        );
        if (requestId !== navRequestRef.current) return;
        if (fullSubsection) {
          subsectionCacheRef.current.set(subsectionId, fullSubsection);
        }
        setSubsection(fullSubsection);
        mappings = await applyAssetMappings(fullSubsection?.assetMappings || []);
        setLevel(NAV_LEVELS.SUBSECTION);
      } else {
        subsectionCacheRef.current.clear();
        subs.forEach((sub) => {
          void prefetchSubsection(sub.id, sectionId);
        });

        setSubsection(null);
        setAssetMappings([]);
        setLevel(NAV_LEVELS.SECTION);
      }

      const targetAssetId = String(assetId || "").trim();
      const targetAddress = String(address || "").trim();
      if (!targetAssetId && !targetAddress) return;

      // Match for address enrichment (fire status) and optional search highlight.
      const matchedMapping = await findHighlightMappingAsync(db, mappings, {
        assetId: targetAssetId,
        address: targetAddress,
      });

      if (requestId !== navRequestRef.current) return;

      if (!matchedMapping) {
        setHighlightedAssetKeys([]);
        if (highlight) {
          toast({
            title: "Opened floor plan",
            description:
              "Could not match the asset marker on this plan. Try selecting it on the map.",
          });
        }
        return;
      }

      // Stamp URL / panel address onto the marker so live F/T colors can match.
      const enrichedMatch = {
        ...matchedMapping,
        deviceAddress:
          resolveMappingDeviceFields(matchedMapping).deviceAddress ||
          targetAddress ||
          matchedMapping.deviceAddress ||
          "",
      };

      // Enrich displayed markers so F/T live colors can resolve by deviceAddress.
      if (subsectionId) {
        setAssetMappings((prev) =>
          prev.map((m) =>
            m.id === enrichedMatch.id ? { ...m, ...enrichedMatch } : m,
          ),
        );
      } else {
        setSectionAssetMappings((prev) =>
          prev.map((m) =>
            m.id === enrichedMatch.id ? { ...m, ...enrichedMatch } : m,
          ),
        );
      }

      // Orange Found frame is search-bar only — never show it after fire acknowledge.
      if (!highlight) {
        setHighlightedAssetKeys([]);
        return;
      }

      const keys = collectAssetHighlightKeys(
        enrichedMatch,
        targetAssetId || targetAddress,
      );
      if (targetAddress) {
        keys.push(...collectAssetHighlightKeys({}, targetAddress));
      }
      startAssetHighlight(keys);

      toast({
        title: "Asset found on floor plan",
        description: "Look for the orange Found frame on the plan.",
      });
    },
    [prefetchSubsection, selectedBuilding, startAssetHighlight, toast, applySectionMappings, applyAssetMappings],
  );

  // Stable key so in-page search / alarm navigation re-applies when only query params change.
  const deepLinkKey = useMemo(() => {
    const parsed = parseFloorPlanViewSearchParams(searchParams);
    if (!parsed) return "";
    return [
      parsed.building,
      parsed.floorId,
      parsed.sectionId,
      parsed.subsectionId || "",
      parsed.assetId || "",
      parsed.address || "",
      parsed.highlight ? "1" : "0",
    ].join("|");
  }, [searchParams]);

  useEffect(() => {
    const parsed = parseFloorPlanViewSearchParams(searchParams);
    if (!parsed) {
      deepLinkRef.current = null;
      return;
    }
    deepLinkRef.current = parsed;
    // Allow the same Graphics View page to navigate again for a new deep link.
    deepLinkAppliedRef.current = false;
  }, [deepLinkKey, searchParams]);

  useEffect(() => {
    const pending = deepLinkRef.current;
    if (!pending || !isReady || communities.length === 0) return;
    if (normalizeBuildingName(selectedBuilding) === pending.building) return;

    const communityId = findCommunityIdForBuilding(communities, pending.building);
    if (communityId) {
      const community = communities.find((c) => c.id === communityId);
      const listValue = findBuildingListValue(community?.buildings || [], pending.building);
      setSelectedCommunity(communityId);
      if (listValue) setSelectedBuilding(listValue);
    }
  }, [isReady, communities, selectedBuilding, deepLinkKey]);

  useEffect(() => {
    const pending = deepLinkRef.current;
    if (!pending || deepLinkAppliedRef.current) return;
    if (isLoading || !selectedBuilding || floors.length === 0) return;
    if (normalizeBuildingName(selectedBuilding) !== pending.building) return;

    deepLinkAppliedRef.current = true;

    void applyNestedDeepLink(pending).catch((error) => {
      console.error("Floor plan deep link failed:", error);
      toast({
        title: "Could not open floor plan",
        description: error?.message || "The asset location could not be loaded.",
        variant: "destructive",
      });
    });
  }, [
    deepLinkKey,
    isLoading,
    selectedBuilding,
    floors.length,
    applyNestedDeepLink,
    toast,
  ]);

  const openDeviceGuide = () => {
    setLevel(NAV_LEVELS.DEVICE_GUIDE);
  };

  const goBack = () => {
    ++navRequestRef.current;
    setPlanImageLoaded(false);
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
    } else if (level === NAV_LEVELS.DEVICE_GUIDE) {
      setLevel(NAV_LEVELS.BUILDING);
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

  const extraAssetTypeKeys = useMemo(
    () =>
      [...sectionAssetMappings, ...assetMappings]
        .map((m) => normalizeAssetTypeKey(m.itemType || m.assetName))
        .filter(Boolean),
    [sectionAssetMappings, assetMappings],
  );

  if (!mounted) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardTopBar />

        <DashboardPageContent className="gap-6 p-4 md:p-6 pt-0">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Eye className="h-6 w-6" />
              Graphics View
              <FaqHelpButton articleId="page-floor-view" size="md" />
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Building → floors → sections.
            </p>
          </div>

          <CommunityBuildingSelect
            communities={communities}
            isLoadingCommunities={isLoadingCommunities}
            selectedCommunity={selectedCommunity}
            onCommunityChange={handleCommunityChange}
            buildings={buildings}
            selectedBuilding={selectedBuilding}
            onBuildingChange={handleBuildingChange}
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
                <div className="flex flex-wrap items-center gap-2">
                  {level === NAV_LEVELS.BUILDING ? (
                    <FloorPlanPlacementCsvActions
                      buildingName={selectedBuilding}
                      onRestored={loadBuildingData}
                    />
                  ) : null}
                  {level !== NAV_LEVELS.BUILDING ? (
                    <AssetTypeIconSettings extraTypes={extraAssetTypeKeys} />
                  ) : null}
                  {level !== NAV_LEVELS.BUILDING && level !== NAV_LEVELS.DEVICE_GUIDE ? (
                    <Badge variant="outline">Live</Badge>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="relative">
                {isNavigating ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[1px]">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : null}

                {highlightedAssetKeys.length > 0 ? (
                  <Alert className="border-green-500 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-100">
                    <AlertTitle className="text-green-700 dark:text-green-300">
                      Searched asset is highlighted on the plan
                    </AlertTitle>
                    <AlertDescription>
                      Look for the orange Found frame on the floor plan below.
                      Fire / trouble colors still show on the marker itself.
                    </AlertDescription>
                  </Alert>
                ) : null}

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
                        showDeviceGuideButton
                        onDeviceGuideClick={openDeviceGuide}
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

                {!isLoading && level === NAV_LEVELS.DEVICE_GUIDE ? (
                  <DeviceIconsGuide />
                ) : null}

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
                    key={`section-${section.id}`}
                    imageUrl={section.imageUrl}
                    alt={section.name}
                    navMarkers={filterPlacedNavMarkers(section.subsectionMarkers)}
                    assetMarkers={sectionAssetMappings}
                    assetStatusLive={assetStatusLive}
                    highlightedAssetKeys={highlightedAssetKeys}
                    onImageLoadedChange={setPlanImageLoaded}
                    onMarkerClick={(m) => openSubsection(m.subsectionId)}
                    onNavMarkerHover={(marker) => {
                      if (marker.subsectionId) {
                        void prefetchSubsection(marker.subsectionId, section.id);
                      }
                    }}
                    onAssetClick={(mapping) => {
                      setSelectedAsset(mapping);
                      setIsAssetModalOpen(true);
                    }}
                    maxHeight="min(75vh, 700px)"
                  />
                )}

                {!isLoading && level === NAV_LEVELS.SUBSECTION && subsection && (
                  <PlanImageCanvas
                    key={`subsection-${subsection.id}`}
                    imageUrl={subsection.imageUrl}
                    alt={subsection.name}
                    assetMarkers={assetMappings}
                    assetStatusLive={assetStatusLive}
                    highlightedAssetKeys={highlightedAssetKeys}
                    onImageLoadedChange={setPlanImageLoaded}
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

        <AssetControlModal
          isOpen={isAssetModalOpen}
          onClose={() => setIsAssetModalOpen(false)}
          asset={selectedAsset}
          userRole={effectiveRole || ""}
          selectedBuilding={selectedBuilding}
          onDeviceStatusChange={({ assetId, enabled }) => {
            const patchList = (list) =>
              list.map((mapping) =>
                mapping.id === assetId || mapping.buildingAssetId === assetId
                  ? { ...mapping, enabled }
                  : mapping,
              );
            setAssetMappings(patchList);
            setSectionAssetMappings(patchList);
            setSelectedAsset((prev) =>
              prev && (prev.id === assetId || prev.buildingAssetId === assetId)
                ? { ...prev, enabled }
                : prev,
            );
          }}
        />
        </DashboardPageContent>
      </SidebarInset>
    </SidebarProvider>
  );
}
