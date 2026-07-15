"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { Loader2, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { db } from "@/config/firebase";
import { searchAssetsByDeviceAddress } from "@/lib/assetDeviceSearch";
import {
  formatPlacementTargetLabel,
  resolveAssetNavigationTarget,
  resolveAssetNavigationUrl,
} from "@/lib/assetPlacementNavigation";
import { buildFloorPlanViewUrl } from "@/lib/fireAlertFloorNavigation";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

let assetsListCache = null;
let assetsListCachePromise = null;

async function loadAssetsListRows() {
  if (assetsListCache) return assetsListCache;
  if (assetsListCachePromise) return assetsListCachePromise;

  assetsListCachePromise = getDocs(collection(db, "AssetsList")).then((snapshot) => {
    const rows = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data(),
    }));
    assetsListCache = rows;
    assetsListCachePromise = null;
    return rows;
  });

  return assetsListCachePromise;
}

/** Fixed search strip — find assets by device address and jump to floor plan. */
export function AssetDeviceSearchBar({ className }) {
  const router = useRouter();
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [navigatingId, setNavigatingId] = useState("");

  async function enrichSearchResults(results) {
    return Promise.all(
      results.map(async (result) => {
        if (result.locationSummary.includes("Section:")) return result;

        const target = await resolveAssetNavigationTarget(result.raw, result.id);
        if (!target?.floorId || !target?.sectionId) return result;

        return {
          ...result,
          locationSummary: formatPlacementTargetLabel(target),
          navigationUrl: buildFloorPlanViewUrl(target),
        };
      }),
    );
  }

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
        const assets = await loadAssetsListRows();
        if (cancelled) return;
        const matches = searchAssetsByDeviceAddress(assets, debouncedQuery);
        setRows(matches);
        const enriched = await enrichSearchResults(matches);
        if (!cancelled) setRows(enriched);
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
  }, [debouncedQuery]);

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
        const url = await resolveAssetNavigationUrl(result.raw, result.id);
        // Always stamp the searched deviceAddress + AssetsList doc id into the URL.
        // Floor-plan marker ids often differ from asset.assetId, so address is the reliable key.
        const parsed = new URL(url, window.location.origin);
        if (result.id) parsed.searchParams.set("assetId", result.id);
        if (result.deviceAddress) {
          parsed.searchParams.set("address", result.deviceAddress);
        }
        // Search-only: show the orange Found frame (not used for fire-ack navigation).
        parsed.searchParams.set("highlight", "1");
        router.push(`${parsed.pathname}?${parsed.searchParams.toString()}`);
      } catch (error) {
        console.error("[asset search] navigation failed:", error);
        const fallback = new URL(
          result.navigationUrl || "/dashboard/floor_configuration/view",
          window.location.origin,
        );
        if (result.id) fallback.searchParams.set("assetId", result.id);
        if (result.deviceAddress) {
          fallback.searchParams.set("address", result.deviceAddress);
        }
        fallback.searchParams.set("highlight", "1");
        router.push(`${fallback.pathname}?${fallback.searchParams.toString()}`);
      } finally {
        setNavigatingId("");
      }
    },
    [router],
  );

  const emptyMessage = useMemo(() => {
    if (loading) return "Searching assets...";
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      return "Type at least 2 characters";
    }
    return `No assets found for "${debouncedQuery}"`;
  }, [debouncedQuery, loading]);

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
        {loading ? (
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
