"use client";

import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import { ImageIcon } from "lucide-react";

export function ResolvedPlanImage({ imageUrl, alt, className }) {
  const src = useResolvedAssetUrl(imageUrl);
  if (!imageUrl) {
    return (
      <div className="flex justify-center py-8 text-muted-foreground">
        <ImageIcon className="h-12 w-12" />
      </div>
    );
  }
  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
