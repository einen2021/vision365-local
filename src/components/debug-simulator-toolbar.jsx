"use client";

import { useState, useEffect } from "react";
import { Flame, AlertTriangle, Radio, RefreshCw, Bug, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDebugMode } from "@/lib/debugMode";
import { simulateDebugMessage, DEMO_DEVICE } from "@/lib/debugSimulation";
import { useToast } from "@/hooks/use-toast";
import { handleSystemResetCompleteWorkflow } from "@/lib/systemResetWorkflow";

export function DebugSimulatorToolbar() {
  const [enabled] = useState(() => {
    if (typeof window !== "undefined") {
      return isDebugMode();
    }
    return false;
  });
  const [expanded, setExpanded] = useState(true);
  const [loadingType, setLoadingType] = useState(null);
  const { toast } = useToast();

  if (!enabled) return null;

  const handleSimulate = async (type) => {
    setLoadingType(type);
    try {
      await simulateDebugMessage(type);
      toast({
        title: `Simulated ${type.toUpperCase()}`,
        description: `Injected message for ${DEMO_DEVICE.address} (${DEMO_DEVICE.location})`,
      });
    } catch (err) {
      toast({
        title: "Simulation Failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingType(null);
    }
  };

  const handleReset = async () => {
    setLoadingType("reset");
    try {
      await handleSystemResetCompleteWorkflow();
      toast({
        title: "Simulated System Reset",
        description: "Reset complete event dispatched and device statuses cleared.",
      });
    } catch (err) {
      toast({
        title: "Reset Failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingType(null);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[99990] flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-background/95 p-1 px-3 shadow-xl backdrop-blur-md ring-1 ring-amber-500/20">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
          <Bug className="h-3.5 w-3.5 animate-pulse" />
          <span>DEBUG SIMULATOR</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
          title={expanded ? "Minimize debug toolbar" : "Expand debug toolbar"}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/80 bg-background/95 p-2.5 shadow-2xl backdrop-blur-md ring-1 ring-black/10 min-w-[260px] animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border-b border-border/50 pb-1 mb-1">
            Demo Device: <span className="font-mono text-foreground font-semibold">2:M1-2-0</span>
          </div>

          <Button
            size="sm"
            variant="destructive"
            className="w-full justify-start gap-2 bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm"
            disabled={loadingType !== null}
            onClick={() => handleSimulate("fire")}
          >
            <Flame className="h-4 w-4 shrink-0 text-white" />
            <span>Simulate Fire Alarm</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-medium"
            disabled={loadingType !== null}
            onClick={() => handleSimulate("trouble")}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Simulate Trouble</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-medium"
            disabled={loadingType !== null}
            onClick={() => handleSimulate("supervisory")}
          >
            <Radio className="h-4 w-4 shrink-0" />
            <span>Simulate Supervisory</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground mt-1 border-t border-border/50 pt-2"
            disabled={loadingType !== null}
            onClick={handleReset}
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0" />
            <span>Simulate System Reset</span>
          </Button>
        </div>
      )}
    </div>
  );
}
