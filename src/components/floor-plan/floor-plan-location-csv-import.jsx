"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadImageNaturalDimensions } from "@/lib/nestedFloorPlan";
import {
  buildMappingsFromLocationCsvRows,
  collectUploadedGeneralAssets,
  parseFloorPlanPlacementCsvFile,
} from "@/lib/floorPlanPlacementCsv";

/**
 * Import x/y locations from a DXF or placement CSV into the current section/subsection plan.
 * Matches rows to uploaded (general) AssetsList assets by deviceAddress.
 */
export function FloorPlanLocationCsvImport({
  buildingName,
  placementContext,
  planImageUrl,
  onImported,
  label = "Import locations from CSV",
}) {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !buildingName || !placementContext) return;

    setIsImporting(true);
    try {
      if (!planImageUrl) {
        toast({
          title: "No plan image",
          description: "Upload a section plan image before importing CSV locations.",
          variant: "destructive",
        });
        return;
      }

      const imageNaturalSize = await loadImageNaturalDimensions(planImageUrl);
      const rows = await parseFloorPlanPlacementCsvFile(file);
      if (rows.length === 0) {
        toast({
          title: "Empty file",
          description: "No rows with deviceAddress were found in the uploaded file.",
          variant: "destructive",
        });
        return;
      }

      const assets = await collectUploadedGeneralAssets(buildingName);
      if (assets.length === 0) {
        toast({
          title: "No uploaded assets",
          description: "No general assets were found in AssetsList for this building.",
          variant: "destructive",
        });
        return;
      }

      const result = buildMappingsFromLocationCsvRows(rows, {
        assets,
        placementContext,
        generalAssetsOnly: true,
        filterToPlacementContext: false,
        imageNaturalSize,
      });

      if (result.mappings.length === 0) {
        const unmatchedNote =
          result.unmatched.length > 0
            ? ` ${result.unmatched.length} address(es) not found in uploaded assets.`
            : "";
        const skippedNote =
          result.skipped.length > 0
            ? ` ${result.skipped.length} row(s) missing x/y coordinates.`
            : "";

        toast({
          title: "No locations imported",
          description: `No matching uploaded assets or valid coordinates for this floor/section.${unmatchedNote}${skippedNote}`,
          variant: "destructive",
        });
        return;
      }

      onImported?.(result);

      const unmatchedNote =
        result.unmatched.length > 0
          ? ` ${result.unmatched.length} address(es) not matched.`
          : "";
      const skippedNote =
        result.skipped.length > 0 ? ` ${result.skipped.length} row(s) skipped.` : "";

      toast({
        title: "Locations imported",
        description: `Added ${result.mappings.length} asset location(s) from CSV. Click Save to persist.${unmatchedNote}${skippedNote}`,
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error?.message || "Could not import locations from file.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (!buildingName || !placementContext) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isImporting}
        onClick={handleImportClick}
      >
        {isImporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {label}
      </Button>
    </>
  );
}
