"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { searchAssetsByDeviceAddress } from "@/lib/assetDeviceSearch";
import {
  getAddressFloorDetailsIndex,
  resolveFloorDetailsFromCache,
  warmAddressFloorDetailsIndex,
} from "@/lib/assetAddressFloorIndex";
import { resolveAssetNavigationUrl } from "@/lib/assetPlacementNavigation";
import {
  buildFloorPlanViewUrl,
  floorPlanUrlHasPlacement,
  stampFloorPlanNavigationParams,
} from "@/lib/fireAlertFloorNavigation";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { readGraphicsViewSelection } from "@/lib/graphicsViewSelection";

const SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

/** When already on Graphics View, reuse the open building if the asset row has none. */
function getBuildingHintFromLocation() {
  if (typeof window === "undefined") return "";
  const fromUrl = normalizeBuildingName(
    new URLSearchParams(window.location.search).get("building") || "",
  );
  if (fromUrl) return fromUrl;
  return normalizeBuildingName(readGraphicsViewSelection()?.building || "");
}

/** Merge AssetsList row with an optional building hint for placement lookup. */
function withBuildingHint(asset = {}, buildingHint = "") {
  const existing = normalizeBuildingName(asset.buildingName || asset.building || "");
  const hint = normalizeBuildingName(buildingHint);
  if (existing || !hint) return asset;
  return { ...asset, buildingName: hint, building: hint };
}

/** Fixed search strip — find assets by device address and jump to floor plan. */
export function AssetDeviceSearchBar({ className }) {
  const router = useRouter();
  const { toast } = useToast();
  const containerRef = useRef(null);
  const floorIndexRef = useRef(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [indexReady, setIndexReady] = useState(false);
  const [rows, setRows] = useState([]);
  const [navigatingId, setNavigatingId] = useState("");

  // Warm address → floor details Map once on mount (shared AssetsList snapshot).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await warmAddressFloorDetailsIndex();
      if (cancelled) return;
      try {
        floorIndexRef.current = await getAddressFloorDetailsIndex();
        setIndexReady(true);
      } catch (error) {
        console.warn("[asset search] index warm failed:", error);
        setIndexReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      if (debouncedQuery.length < MIN_QUERY_LENGTH) {
        setRows([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Always refresh from the module index so live open-plan markers are included.
        const floorIndex = await getAddressFloorDetailsIndex();
        floorIndexRef.current = floorIndex;
        if (cancelled) return;

        const buildingHint = getBuildingHintFromLocation();
        // Search + attach Building/Floor/Section from the in-memory Map.
        const matches = searchAssetsByDeviceAddress(floorIndex.rows, debouncedQuery, {
          floorIndex,
          buildingHint,
        });
        if (!cancelled) setRows(matches);
      } catch (error) {
        console.error("[asset search] failed:", error);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, indexReady]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const showResults = open && debouncedQuery.length >= MIN_QUERY_LENGTH;

  const handleSelect = useCallback(
    async (result) => {
      setOpen(false);
      setQuery(result.deviceAddress || "");
      setNavigatingId(result.id);

      try {
        const buildingHint = getBuildingHintFromLocation();

        // 1) Prefer URL already built from the address → floor Map (instant).
        if (floorPlanUrlHasPlacement(result.navigationUrl)) {
          router.push(
            stampFloorPlanNavigationParams(result.navigationUrl, {
              assetId: result.id,
              address: result.deviceAddress,
              highlight: true,
            }),
          );
          return;
        }

        // 2) Re-check the Map (includes markers registered from the open plan).
        const floorIndex =
          floorIndexRef.current || (await getAddressFloorDetailsIndex());
        floorIndexRef.current = floorIndex;
        const details = resolveFloorDetailsFromCache(
          floorIndex,
          result.raw,
          result.id,
          buildingHint,
        );

        if (details?.building && details?.floorId && details?.sectionId) {
          router.push(
            stampFloorPlanNavigationParams(buildFloorPlanViewUrl(details), {
              assetId: result.id,
              address: result.deviceAddress,
              highlight: true,
            }),
          );
          return;
        }

        // 3) Fallback: scan nested floor mappings for this building (asset may
        //    be placed only in assetMappings, not denormalized on AssetsList).
        const url = await resolveAssetNavigationUrl(
          withBuildingHint(result.raw, buildingHint),
          result.id,
        );
        if (floorPlanUrlHasPlacement(url)) {
          router.push(
            stampFloorPlanNavigationParams(url, {
              assetId: result.id,
              address: result.deviceAddress,
              highlight: true,
            }),
          );
          return;
        }

        toast({
          title: "Asset not on a nested floor plan",
          description: `${result.deviceAddress || "This asset"} is not placed on a floor/section yet.`,
        });
      } catch (error) {
        console.error("[asset search] navigation failed:", error);
        toast({
          title: "Could not open floor plan",
          description: error?.message || "Placement lookup failed for this asset.",
        });
      } finally {
        setNavigatingId("");
      }
    },
    [router, toast],
  );

  const emptyMessage = useMemo(() => {
    if (loading || !indexReady) return "Searching assets...";
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      return "Type at least 2 characters";
    }
    return `No assets found for "${debouncedQuery}"`;
  }, [debouncedQuery, indexReady, loading]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative border-t bg-muted/30 px-4 py-2 md:px-8",
        className,
      )}
    >
      <div className="relative mx-auto w-full max-w-3xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search asset by device address (e.g. M1-2-1 or 2:M1-2-1)"
          className="h-10 bg-background pl-9 pr-10"
          aria-label="Search asset by device address"
          autoComplete="off"
        />
        {loading || !indexReady ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {showResults ? (
        <div className="mx-auto mt-2 w-full max-w-3xl overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {rows.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {rows.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    disabled={navigatingId === result.id}
                    className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/70 disabled:opacity-60"
                    onClick={() => void handleSelect(result)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {result.deviceAddress || "No address"}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {result.name}
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{result.locationSummary}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
