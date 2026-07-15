"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { MapPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientMainRoute } from "@/config/role-routes";
import { normalizePathname } from "@/lib/roleAccess";
import { useAppData } from "@/hooks/useAppData";
import {
  buildGraphicsViewUrl,
  resolveGraphicsViewSelection,
  saveGraphicsViewSelection,
} from "@/lib/graphicsViewSelection";

/** Quick link back to Graphics View — hidden when already on that page. */
export function GraphicsViewNavButton({ className = "" }) {
  const pathname = normalizePathname(usePathname());
  const graphicsViewPath = normalizePathname(clientMainRoute);
  const {
    communities,
    selectedCommunity,
    selectedBuilding,
    allBuildings,
  } = useAppData();

  const href = useMemo(() => {
    const selection = resolveGraphicsViewSelection({
      communities,
      selectedCommunity: selectedCommunity || "",
      selectedBuilding: selectedBuilding || "",
      allBuildings,
    });
    return buildGraphicsViewUrl(selection || undefined);
  }, [allBuildings, communities, selectedBuilding, selectedCommunity]);

  if (pathname === graphicsViewPath) {
    return null;
  }

  const handleNavigate = () => {
    const selection = resolveGraphicsViewSelection({
      communities,
      selectedCommunity: selectedCommunity || "",
      selectedBuilding: selectedBuilding || "",
      allBuildings,
    });
    if (selection) {
      saveGraphicsViewSelection(selection);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={`shrink-0 ${className}`.trim()}
      asChild
    >
      <Link
        href={href}
        title="Graphics View"
        aria-label="Graphics View"
        onClick={handleNavigate}
      >
        <MapPlus className="h-4 w-4" />
        <span className="sr-only">Graphics View</span>
      </Link>
    </Button>
  );
}
