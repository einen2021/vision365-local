"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/contexts/AppContext";
import { normalizeRoleKey } from "@/lib/roleAccess";
import {
  collectFloorPlanPlacementRows,
  collectUploadedGeneralAssets,
  downloadFloorPlanPlacementCsv,
  parseFloorPlanPlacementCsvFile,
  restoreFloorPlanPlacementsFromCsv,
} from "@/lib/floorPlanPlacementCsv";

/**
 * Export / import floor-plan placement CSV for a building.
 * Restore matches rows to uploaded (general) AssetsList assets by deviceAddress.
 */
export function FloorPlanPlacementCsvActions({ buildingName, onRestored }) {
  const { toast } = useToast();
  const { userRole } = useApp();
  const fileInputRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    if (!buildingName) return;
    setIsExporting(true);
    try {
      const rows = await collectFloorPlanPlacementRows(buildingName);
      if (rows.length === 0) {
        toast({
          title: "Nothing to export",
          description: "No placed assets with floor-plan details were found for this building.",
          variant: "destructive",
        });
        return;
      }
      downloadFloorPlanPlacementCsv(buildingName, rows);
      toast({
        title: "Export complete",
        description: `Downloaded ${rows.length} placement row(s).`,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error?.message || "Could not export placements.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !buildingName) return;

    setIsImporting(true);
    try {
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

      const result = await restoreFloorPlanPlacementsFromCsv(buildingName, rows, { assets });
      onRestored?.();

      const unmatchedNote =
        result.unmatched.length > 0
          ? ` ${result.unmatched.length} address(es) not found in uploaded assets.`
          : "";
      const skippedNote =
        result.skipped.length > 0
          ? ` ${result.skipped.length} row(s) skipped (missing floor/section or x/y).`
          : "";

      toast({
        title: result.restored > 0 ? "Restore complete" : "No placements restored",
        description:
          result.restored > 0
            ? `Restored ${result.restored} placement(s) from ${assets.length} uploaded asset(s). Updated coordinates for ${result.coordinateUpdates}.${unmatchedNote}${skippedNote}`
            : `No matching uploaded assets or valid placement targets found.${unmatchedNote}${skippedNote}`,
        variant: result.restored > 0 ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error?.message || "Could not restore placements from file.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (!buildingName) return null;
  if (normalizeRoleKey(userRole) === "client") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        disabled={isExporting || isImporting}
        onClick={handleExport}
      >
        {isExporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Export placements CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isExporting || isImporting}
        onClick={handleImportClick}
      >
        {isImporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        Restore from CSV
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        DXF CSV columns: deviceAddress, X, Y, Floor, Block. Matches uploaded assets by device address.
      </p>
    </div>
  );
}
