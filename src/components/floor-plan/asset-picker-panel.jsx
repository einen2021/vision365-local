"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, Layers, Loader2, Package, Save, Trash2, X } from "lucide-react";
import { useAssetTypeIcons } from "@/contexts/AssetTypeIconsContext";
import {
  getIconForAssetType,
  handleImageError,
  resolveAssetTypeFromMapping,
} from "@/lib/assetIcons";
import {
  formatNestedPlacementLabel,
  getAssetPlacementLabel,
  getPickerAssetPlacementLocation,
  isPickerAssetUnavailable,
  matchesAssetAddressSearch,
} from "@/lib/floorMapAssets";

/**
 * Pick general (AssetsList) or building assets and place them on a floor plan.
 */
export function AssetPickerPanel({
  title = "Assets",
  assetMode,
  onAssetModeChange,
  generalAssets,
  buildingAssets,
  onLoadGeneral,
  onLoadBuilding,
  isLoadingGeneral,
  isLoadingBuilding,
  assetSearch,
  onAssetSearchChange,
  selectedAsset,
  onSelectAsset,
  onClearSelection,
  placedCount,
  placedMappings = [],
  onRemovePlaced,
  onDeletePlacement,
  deletingPlacementKey = null,
  onSave,
  onClearAllAndSave,
  isSaving,
  saveLabel = "Save Assets",
  buildingName,
  headerAction = null,
  currentPlacementContext = null,
}) {
  const { overrides } = useAssetTypeIcons();
  const UNAVAILABLE_DISPLAY_LIMIT = 100;
  const sourceList = assetMode === "general" ? generalAssets : buildingAssets;
  const searchedAssets = sourceList.filter((a) => matchesAssetAddressSearch(a, assetSearch));
  const list = searchedAssets.filter((a) => !isPickerAssetUnavailable(a, placedMappings));
  const unavailableAssets = searchedAssets.filter((a) =>
    isPickerAssetUnavailable(a, placedMappings),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 font-semibold">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {title}
        </div>
        {headerAction}
      </div>

      <Tabs value={assetMode} onValueChange={onAssetModeChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="general" className="flex items-center gap-1 text-xs">
            <Database className="h-3 w-3" />
            General
          </TabsTrigger>
          <TabsTrigger value="building" className="flex items-center gap-1 text-xs">
            <Layers className="h-3 w-3" />
            Building
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-3 mt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onLoadGeneral}
            disabled={isLoadingGeneral}
          >
            {isLoadingGeneral ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Database className="mr-2 h-4 w-4" />
            )}
            Load General Assets
          </Button>
          <p className="text-xs text-muted-foreground">
            From AssetsList for {buildingName || "this building"}
          </p>
        </TabsContent>

        <TabsContent value="building" className="space-y-3 mt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onLoadBuilding}
            disabled={isLoadingBuilding}
          >
            {isLoadingBuilding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Layers className="mr-2 h-4 w-4" />
            )}
            Load Building Assets
          </Button>
          <p className="text-xs text-muted-foreground">
            From {buildingName} building database
          </p>
        </TabsContent>
      </Tabs>

      <Input
        placeholder="Search by address, location..."
        value={assetSearch}
        onChange={(e) => onAssetSearchChange(e.target.value)}
      />

      <div className="max-h-40 overflow-y-auto space-y-1">
        {list.length === 0 ? (
          unavailableAssets.length > 0 ? (
            <div className="space-y-2 py-1">
              <p className="text-xs font-medium text-muted-foreground">
                Already placed ({unavailableAssets.length})
              </p>
              {unavailableAssets.slice(0, UNAVAILABLE_DISPLAY_LIMIT).map((a) => {
                const location = getPickerAssetPlacementLocation(
                  a,
                  placedMappings,
                  currentPlacementContext,
                );
                return (
                  <div
                    key={`placed-${assetMode}-${a.id}`}
                    className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {getAssetPlacementLabel(a)}
                      </p>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {location || "Placement location unknown"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title="Clear building placement"
                      disabled={deletingPlacementKey === `${assetMode}-${a.id}`}
                      onClick={() => onDeletePlacement?.(a)}
                    >
                      {deletingPlacementKey === `${assetMode}-${a.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                );
              })}
              {unavailableAssets.length > UNAVAILABLE_DISPLAY_LIMIT ? (
                <p className="text-[11px] text-muted-foreground">
                  + {unavailableAssets.length - UNAVAILABLE_DISPLAY_LIMIT} more — use search to
                  narrow the list
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              {sourceList.length > 0
                ? "No assets match your search."
                : assetMode === "general"
                  ? "Click Load General Assets to list devices."
                  : "Click Load Building Assets to list devices."}
            </p>
          )
        ) : (
          list.map((a) => (
            <Button
              key={`${assetMode}-${a.id}`}
              variant={selectedAsset?.id === a.id && selectedAsset?.assetMode === a.assetMode ? "default" : "outline"}
              size="sm"
              className="w-full justify-start"
              onClick={() => onSelectAsset(a)}
            >
              <img
                src={getIconForAssetType(resolveAssetTypeFromMapping(a), null, overrides)}
                alt=""
                className="mr-2 h-4 w-4 shrink-0"
                onError={handleImageError}
              />
              <span className="truncate">{getAssetPlacementLabel(a)}</span>
            </Button>
          ))
        )}
      </div>

      {selectedAsset ? (
        <Badge className="max-w-full">
          <span className="truncate">
            Click map: {getAssetPlacementLabel(selectedAsset)}
          </span>
          <button type="button" className="ml-2 shrink-0" onClick={onClearSelection}>
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ) : null}

      {placedMappings.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Placed on map</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {placedMappings.map((mapping) => (
              <div
                key={mapping.id}
                className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5"
              >
                <img
                  src={getIconForAssetType(resolveAssetTypeFromMapping(mapping), null, overrides)}
                  alt=""
                  className="h-4 w-4 shrink-0"
                  onError={handleImageError}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {getAssetPlacementLabel(mapping)}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatNestedPlacementLabel({
                      ...currentPlacementContext,
                      ...mapping,
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="Remove marker"
                  onClick={() => onRemovePlaced?.(mapping.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Or click a marker on the map to remove it.
          </p>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">{placedCount} asset(s) placed</p>

      {placedMappings.length > 0 && onClearAllAndSave ? (
        <Button
          type="button"
          variant="outline"
          className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onClearAllAndSave}
          disabled={isSaving}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remove all and save
        </Button>
      ) : null}

      <Button className="w-full" onClick={onSave} disabled={isSaving}>
        {isSaving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-2 h-4 w-4" />
        )}
        {saveLabel}
      </Button>
    </div>
  );
}
