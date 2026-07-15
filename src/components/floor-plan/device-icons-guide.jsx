"use client";

import { useMemo, useState } from "react";
import { Loader2, Map } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AssetTypeMarkerImage } from "@/components/floor-plan/asset-type-marker-image";
import { useAssetTypeIcons } from "@/contexts/AssetTypeIconsContext";
import { buildDeviceGuideItems } from "@/lib/floorPlanLegend";

/** Full-page guide of asset types from AssetsList (same list as Customize Icons). */
export function DeviceIconsGuide({ extraTypes = [] }) {
  const { overrides, knownTypes, loading } = useAssetTypeIcons();
  const [search, setSearch] = useState("");

  const items = useMemo(
    () => buildDeviceGuideItems({ knownTypes, extraTypes, overrides }),
    [knownTypes, extraTypes, overrides],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.label.toLowerCase().includes(query));
  }, [items, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Map className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Legend</h2>
            <p className="text-sm text-muted-foreground">
              Asset types from your Assets list, with built-in or custom icons.
            </p>
          </div>
        </div>
        <Input
          placeholder="Search device types..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading asset types...
        </div>
      ) : filteredItems.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {search.trim()
            ? "No device types match your search."
            : "No asset types found. Load assets in Assets first."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-background">
                <AssetTypeMarkerImage
                  mapping={item.mapping}
                  typeIconUrl={item.typeIconUrl}
                  alt={item.label}
                  className="h-8 w-8 object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={item.label}>
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.hasCustomIcon ? "Custom icon" : "Built-in icon"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
