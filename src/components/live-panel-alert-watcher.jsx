"use client";

import { useEffect, useRef } from "react";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";

/** Clears trouble / supervisory alert beeps when panel counts return to zero. */
export function LivePanelAlertWatcher() {
  const { firePanelState } = useFirePanelMonitor();
  const { handleTroubleCountChange, handleSupervisoryCountChange } = useLivePanelAlert();
  const totalTrouble = firePanelState?.totalTrouble ?? 0;
  const totalSupervisory = firePanelState?.totalSupervisory ?? 0;

  const prevTroubleRef = useRef(null);
  const prevSupervisoryRef = useRef(null);

  useEffect(() => {
    if (prevTroubleRef.current === null) {
      prevTroubleRef.current = totalTrouble;
      return;
    }

    if (totalTrouble === 0) {
      handleTroubleCountChange(0);
    }

    prevTroubleRef.current = totalTrouble;
  }, [handleTroubleCountChange, totalTrouble]);

  useEffect(() => {
    if (prevSupervisoryRef.current === null) {
      prevSupervisoryRef.current = totalSupervisory;
      return;
    }

    if (totalSupervisory === 0) {
      handleSupervisoryCountChange(0);
    }

    prevSupervisoryRef.current = totalSupervisory;
  }, [handleSupervisoryCountChange, totalSupervisory]);

  return null;
}
