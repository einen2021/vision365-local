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
    if (!imageLoaded || !imageRef.current) return;

    const onResize = () => recalculate();
    window.addEventListener("resize", onResize);

    const element = imageRef.current;
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => recalculate());
      observer.observe(element);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [imageLoaded, recalculate, imageRef]);

  return { dims, imageLoaded, handleImageLoad, recalculate };
}
