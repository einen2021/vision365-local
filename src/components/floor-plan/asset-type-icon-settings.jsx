"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Loader2, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAssetTypeIcons } from "@/contexts/AssetTypeIconsContext";
import {
  getIconForAssetType,
  handleImageError,
} from "@/lib/assetIcons";
import { buildAssetTypeList } from "@/lib/floorPlanLegend";
import { isAssetImageLoaded, preloadAssetImage } from "@/lib/assetUrlCache";

function AssetTypeIconPreview({ src, fallbackSrc, alt = "" }) {
  const [displaySrc, setDisplaySrc] = useState(fallbackSrc);

  useEffect(() => {
    if (!src || src === fallbackSrc) {
      setDisplaySrc(fallbackSrc);
      return;
    }

    if (isAssetImageLoaded(src)) {
      setDisplaySrc(src);
      return;
    }

    let cancelled = false;
    setDisplaySrc(fallbackSrc);

    void preloadAssetImage(src).then((loaded) => {
      if (!cancelled) {
        setDisplaySrc(loaded ? src : fallbackSrc);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fallbackSrc, src]);

  return (
    <img
      src={displaySrc}
      alt={alt}
      className="h-8 w-8 shrink-0 rounded-full border bg-white object-contain p-0.5"
      onError={handleImageError}
    />
  );
}

export function AssetTypeIconSettings({ extraTypes = [] }) {
  const { toast } = useToast();
  const { overrides, knownTypes, loading, uploadTypeIcon, clearTypeIcon } = useAssetTypeIcons();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busyType, setBusyType] = useState(null);
  const fileInputRef = useRef(null);
  const pendingTypeRef = useRef("");

  const typeList = useMemo(
    () => buildAssetTypeList({ knownTypes, extraTypes, overrides }),
    [knownTypes, extraTypes, overrides],
  );

  const filteredTypes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return typeList;
    return typeList.filter((type) => type.toLowerCase().includes(q));
  }, [typeList, search]);

  const startUpload = (typeKey) => {
    pendingTypeRef.current = typeKey;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    const typeKey = pendingTypeRef.current;
    event.target.value = "";

    if (!file || !typeKey) return;

    setBusyType(typeKey);
    try {
      await uploadTypeIcon(typeKey, file);
      toast({
        title: "Icon updated",
        description: `Custom icon saved for ${typeKey}.`,
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error?.message || "Could not save custom icon.",
        variant: "destructive",
      });
    } finally {
      setBusyType(null);
      pendingTypeRef.current = "";
    }
  };

  const handleReset = async (typeKey) => {
    setBusyType(typeKey);
    try {
      await clearTypeIcon(typeKey);
      toast({
        title: "Icon reset",
        description: `${typeKey} now uses the default type icon.`,
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error?.message || "Could not reset icon.",
        variant: "destructive",
      });
    } finally {
      setBusyType(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <ImageIcon className="mr-2 h-4 w-4" />
          Customize Icons
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Asset type icons</DialogTitle>
          <DialogDescription>
            Upload a custom marker image per asset type. Icons are stored in app data and used on
            floor plans. Built-in icons come from <code>/public/asset/icons/</code>.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search asset types..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.svg"
          className="hidden"
          onChange={(e) => void handleFileChange(e)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading asset types...
            </div>
          ) : filteredTypes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No asset types found. Load assets in Assets first.
            </p>
          ) : (
            filteredTypes.map((typeKey) => {
              const iconSrc = overrides[typeKey] || getIconForAssetType(typeKey);
              const fallbackSrc = getIconForAssetType(typeKey);
              const hasCustom = Boolean(overrides[typeKey]);
              const isBusy = busyType === typeKey;

              return (
                <div
                  key={typeKey}
                  className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2"
                >
                  <AssetTypeIconPreview src={iconSrc} fallbackSrc={fallbackSrc} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{typeKey}</p>
                    <p className="text-xs text-muted-foreground">
                      {hasCustom ? "Custom upload" : "Built-in icon"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => startUpload(typeKey)}
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Upload className="mr-1 h-3.5 w-3.5" />
                        Upload
                      </>
                    )}
                  </Button>
                  {hasCustom ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleReset(typeKey)}
                      title="Use built-in icon"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
