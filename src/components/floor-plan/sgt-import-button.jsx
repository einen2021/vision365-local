"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import FirestoreService from "@/services/firestoreService";
import {
  extractSgtFile,
  isSgtDeviceRow,
  isSgtFilePathLabel,
} from "@/lib/sgtExtractor";
import {
  computeCoordinateBounds,
  csvCoordsToRelativePlacement,
  buildNestedPlacementContext,
  buildSgtTextLabelPlacements,
  buildSgtNavButtonPlacements,
} from "@/lib/nestedFloorPlan";
import {
  buildPlacementMapping,
  mergePlacementMappings,
} from "@/lib/floorPlanPlacementCsv";

/**
 * Import from SGT — orchestrates extract → image → assets → placements → labels → nav pins.
 * Uses the local SQLite document DB via FirestoreService (not cloud Firestore).
 */
export function SgtImportButton({
  buildingName,
  targetLevel = "floor",
  floor = null,
  section = null,
  subsection = null,
  onPlanImageUploaded,
  onAssetsCreated,
  onPlacementsReady,
  onTextLabelsReady,
  onNavButtonsReady,
}) {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleClick = () => {
    if (!buildingName) {
      toast({
        title: "Select a building",
        description: "Choose a building before importing an SGT file.",
        variant: "destructive",
      });
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // Step 0 — basic validation
    if (!buildingName) {
      toast({
        title: "Select a building",
        description: "Choose a building before importing an SGT file.",
        variant: "destructive",
      });
      return;
    }
    if (!String(file.name || "").toLowerCase().endsWith(".sgt")) {
      toast({
        title: "Invalid file",
        description: "Please choose a .sgt file.",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    // One toast we update while waiting for a cold-start wake-up
    const progressToast = toast({
      title: "Reading SGT…",
      description: "Connecting to extractor (wakes up if idle)…",
    });

    try {
      // Step 1 — extract via remote API (waits for cold start if spun down)
      const extracted = await extractSgtFile(file, {
        onStatus: (message) => {
          progressToast.update({
            id: progressToast.id,
            title: "Reading SGT…",
            description: message,
          });
        },
      });

      // Step 2 — branch: devices+texts vs buttons-only
      // Devices need Name + deviceType (not TEXT_LABEL)
      const devices = (extracted.devices || []).filter(isSgtDeviceRow);

      // TEXT labels: layer TEXT, finite coords, not CAD file-path junk
      const labelRows = (extracted.labels || []).filter((row) => {
        if (String(row.layer || "").toUpperCase() !== "TEXT") return false;
        if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) return false;
        const text = row.text || row.label || row.object_name || "";
        if (isSgtFilePathLabel(text)) return false;
        return true;
      });

      // Buttons ONLY when zero usable devices (overview / zone plans).
      // If any devices exist, buttons are forced off even if the API sent them.
      const buttonRows =
        devices.length === 0 && Array.isArray(extracted.buttons)
          ? extracted.buttons.filter(
              (row) => Number.isFinite(row.x) && Number.isFinite(row.y),
            )
          : [];

      if (
        !extracted.planBitmap &&
        devices.length === 0 &&
        labelRows.length === 0 &&
        buttonRows.length === 0
      ) {
        toast({
          title: "Nothing found",
          description:
            "This SGT had no plan image, devices, TEXT labels, or nav buttons.",
          variant: "destructive",
        });
        return;
      }

      // Path A (no devices): imageFit fill + buttons
      // Path B (has devices): imageFit contain + assets/markers; buttons ignored
      const imageFit = devices.length === 0 ? "fill" : "contain";
      let imageNaturalWidth = extracted.planBitmap?.width || 0;
      let imageNaturalHeight = extracted.planBitmap?.height || 0;
      let uploadedUrl = null;

      // Step 3 — upload plan image + store imageFit
      if (extracted.planBitmap?.blob) {
        const planFile = new File(
          [extracted.planBitmap.blob],
          extracted.planBitmap.fileName || "sgt-plan.png",
          { type: extracted.planBitmap.contentType || "image/png" },
        );

        if (targetLevel === "floor" && floor?.id) {
          uploadedUrl = await FirestoreService.uploadNestedFloorImage(
            buildingName,
            floor.id,
            planFile,
          );
          await FirestoreService.updateFloorPlanImageFit(
            buildingName,
            floor.id,
            imageFit,
          );
        } else if (targetLevel === "section" && floor?.id && section?.id) {
          uploadedUrl = await FirestoreService.uploadNestedSectionImage(
            buildingName,
            floor.id,
            section.id,
            planFile,
          );
          await FirestoreService.updateSectionPlanImageFit(
            buildingName,
            floor.id,
            section.id,
            imageFit,
          );
        } else if (
          targetLevel === "subsection" &&
          floor?.id &&
          section?.id &&
          subsection?.id
        ) {
          uploadedUrl = await FirestoreService.uploadNestedSubsectionImage(
            buildingName,
            floor.id,
            section.id,
            subsection.id,
            planFile,
          );
          await FirestoreService.updateSubsectionPlanImageFit(
            buildingName,
            floor.id,
            section.id,
            subsection.id,
            imageFit,
          );
        }

        if (uploadedUrl) {
          onPlanImageUploaded?.(uploadedUrl, {
            width: imageNaturalWidth,
            height: imageNaturalHeight,
            imageFit,
          });
        }
      }

      // Step 4 — create / merge fire-life-safety building assets
      let createdAssets = [];
      if (devices.length > 0) {
        const result = await FirestoreService.createBuildingAssetsFromSgt(
          buildingName,
          devices,
        );
        createdAssets = result.assets || [];
        onAssetsCreated?.(result);
      }

      // Step 5 — shared coordinate space for devices, labels, and buttons
      const points = [...devices, ...labelRows, ...buttonRows]
        .map((row) => ({ x: row.x, y: row.y }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      const bounds = computeCoordinateBounds(points);
      const coordOptions = {
        bounds,
        imageNaturalWidth,
        imageNaturalHeight,
        flipY: true, // SGT/DXF Y-up → image Y-down
      };

      // Step 6 — device marker placements (section / subsection only; user must Save)
      if (
        (targetLevel === "section" || targetLevel === "subsection") &&
        devices.length > 0 &&
        createdAssets.length > 0
      ) {
        const placementContext = buildNestedPlacementContext({
          buildingName,
          floor,
          section,
          subsection: targetLevel === "subsection" ? subsection : null,
          placementLevel: targetLevel,
        });

        const mappings = [];
        devices.forEach((row, index) => {
          const asset = createdAssets.find(
            (item) =>
              String(item.deviceAddress || "").trim() ===
              String(row.Name || row.name || "").trim(),
          );
          if (!asset) return;

          const coords = csvCoordsToRelativePlacement(row.x, row.y, coordOptions);
          if (!coords) return;

          mappings.push(
            buildPlacementMapping({
              asset: { ...asset, assetMode: "building" },
              coords,
              placementContext,
              mappingIndex: index,
              deviceAddressOverride: row.Name || row.name,
            }),
          );
        });

        if (mappings.length > 0) {
          onPlacementsReady?.(mappings, mergePlacementMappings);
        }
      }

      // Step 7 — TEXT labels (persisted immediately on the plan doc)
      if (labelRows.length > 0) {
        const textLabels = buildSgtTextLabelPlacements(labelRows, coordOptions);

        if (targetLevel === "floor" && floor?.id) {
          await FirestoreService.updateFloorTextLabels(
            buildingName,
            floor.id,
            textLabels,
          );
        } else if (targetLevel === "section" && floor?.id && section?.id) {
          await FirestoreService.updateSectionTextLabels(
            buildingName,
            floor.id,
            section.id,
            textLabels,
          );
        } else if (
          targetLevel === "subsection" &&
          floor?.id &&
          section?.id &&
          subsection?.id
        ) {
          await FirestoreService.updateSubsectionTextLabels(
            buildingName,
            floor.id,
            section.id,
            subsection.id,
            textLabels,
          );
        }

        onTextLabelsReady?.(textLabels);
      }

      // Step 8 — nav buttons when devices are empty (overview plans)
      if (
        buttonRows.length > 0 &&
        (targetLevel === "floor" || targetLevel === "section")
      ) {
        const navButtons = buildSgtNavButtonPlacements(buttonRows, coordOptions);
        if (navButtons.length > 0) {
          await onNavButtonsReady?.(navButtons);
        }
      }

      const parts = [];
      if (uploadedUrl) parts.push("plan image");
      if (createdAssets.length) parts.push(`${createdAssets.length} asset(s)`);
      if (labelRows.length) parts.push(`${labelRows.length} label(s)`);
      if (buttonRows.length) parts.push(`${buttonRows.length} nav pin(s)`);

      const saveNote =
        devices.length > 0 &&
        (targetLevel === "section" || targetLevel === "subsection")
          ? " Click Save to persist device markers."
          : "";

      toast({
        title: "SGT import complete",
        description: `${parts.join(", ") || "Done"}.${saveNote}`,
      });
    } catch (error) {
      toast({
        title: "SGT import failed",
        description: error?.message || "Could not import this SGT file.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".sgt,application/octet-stream"
        className="hidden"
        onChange={handleFile}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isImporting || !buildingName}
        onClick={handleClick}
      >
        {isImporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileUp className="mr-2 h-4 w-4" />
        )}
        Import from SGT
      </Button>
    </>
  );
}
