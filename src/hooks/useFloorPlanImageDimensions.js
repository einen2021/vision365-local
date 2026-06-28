"use client";

import { useState, useCallback, useEffect } from "react";
import { calculateDisplayedImageDimensions } from "@/lib/nestedFloorPlan";

const EMPTY_DIMS = {
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: 0,
  naturalWidth: 0,
  naturalHeight: 0,
};

/** Track how a floor-plan image is rendered inside its container (for marker placement). */
export function useFloorPlanImageDimensions(imageRef, imageUrl) {
  const [dims, setDims] = useState(EMPTY_DIMS);
  const [imageLoaded, setImageLoaded] = useState(false);

  const recalculate = useCallback(() => {
    if (!imageRef.current) return;
    setDims(calculateDisplayedImageDimensions(imageRef.current));
    setImageLoaded(true);
  }, [imageRef]);

  const handleImageLoad = useCallback(() => {
    recalculate();
  }, [recalculate]);

  useEffect(() => {
    setImageLoaded(false);
    setDims(EMPTY_DIMS);
  }, [imageUrl]);

  useEffect(() => {
    const onResize = () => recalculate();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recalculate]);

  return { dims, imageLoaded, handleImageLoad, recalculate };
}
