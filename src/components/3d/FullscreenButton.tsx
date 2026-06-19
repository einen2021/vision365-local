/**
 * FullscreenButton.tsx
 * Button component for toggling fullscreen mode on the 3D viewer
 */

import { useState, useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FullscreenButtonProps {
  targetRef: React.RefObject<HTMLDivElement>;
}

export function FullscreenButton({ targetRef }: FullscreenButtonProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!targetRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await targetRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Error toggling fullscreen:", error);
    }
  };

  return (
    <Button
      onClick={toggleFullscreen}
      size="icon"
      variant="outline"
      className="absolute top-4 right-4 z-50 bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm"
      title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
    >
      {isFullscreen ? (
        <Minimize2 className="h-4 w-4" />
      ) : (
        <Maximize2 className="h-4 w-4" />
      )}
    </Button>
  );
}
