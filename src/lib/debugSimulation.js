import { apiUrl } from "@/lib/apiClient";
import { extractPanelEventTime } from "@/lib/firePanelMonitor";
import {
  appendLiveLogToCategoryList,
  recordLiveAlarmToHistory,
} from "@/lib/recordAlarmHistory";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

export const DEMO_DEVICE = {
  address: "2:M1-2-0",
  location: "SUB BS CRDR COS 21 SB/L1/2",
  pullStationDevice: "PULL STATION",
  supervisoryDevice: "SUPERVISORY MONITOR",
  rawTrouble:
    " 1:49:24 am  WED 01-JAN-97 SUB BS CRDR COS 21 SB/L1/2\n             PULL STATION                  DISABLE TROUBLE ",
  rawFire:
    " 1:49:24 am  WED 01-JAN-97 SUB BS CRDR COS 21 SB/L1/2\n             PULL STATION                  FIRE ALARM ",
  rawSupervisory:
    " 1:49:24 am  WED 01-JAN-97 SUB BS CRDR COS 21 SB/L1/2\n             SUPERVISORY MONITOR           SUPERVISORY ",
};

/**
 * Simulate adding a live panel message for Fire, Trouble, or Supervisory.
 * Injects into desktop server logs / SSE and updates local category list & history.
 *
 * @param {"fire"|"trouble"|"supervisory"} type
 * @param {Object} [custom] - optional overrides for location, deviceAddress, status, etc.
 */
export async function simulateDebugMessage(type = "trouble", custom = {}) {
  const normType = String(type || "trouble").toLowerCase();
  const label =
    normType === "fire" ? "Fire" : normType === "supervisory" ? "Supervisory" : "Trouble";

  let rawMessage = DEMO_DEVICE.rawTrouble;
  let deviceType = DEMO_DEVICE.pullStationDevice;
  let status = "DISABLE TROUBLE";
  let statusToken = "TRBL*";
  let simplexFlag = "T";

  if (normType === "fire") {
    rawMessage = DEMO_DEVICE.rawFire;
    deviceType = DEMO_DEVICE.pullStationDevice;
    status = "FIRE ALARM";
    statusToken = "FIRE*";
    simplexFlag = "F";
  } else if (normType === "supervisory") {
    rawMessage = DEMO_DEVICE.rawSupervisory;
    deviceType = DEMO_DEVICE.supervisoryDevice;
    status = "SUPERVISORY";
    statusToken = "SUPV*";
    simplexFlag = "S";
  }

  const location = custom.location || DEMO_DEVICE.location;
  const deviceAddress = custom.deviceAddress || DEMO_DEVICE.address;
  if (custom.raw) rawMessage = custom.raw;
  if (custom.deviceType) deviceType = custom.deviceType;
  if (custom.status) status = custom.status;

  const { timeMs, timestampIso, panelTimeText } = extractPanelEventTime(rawMessage);

  const entry = {
    kind: normType === "fire" ? "fire" : normType === "supervisory" ? "supervisory" : "trouble",
    time: "1:49:24 am",
    weekday: "WED",
    date: "01-JAN-97",
    location,
    device: deviceType,
    deviceType,
    deviceAddress,
    fullAddress: deviceAddress,
    status,
    raw: rawMessage,
    at: new Date().toISOString(),
    panelTimeText,
  };

  // 1. Send to desktop-server simulation API if available (broadcasts via SSE to all listeners)
  let serverSimulated = false;
  try {
    const res = await fetch(apiUrl("/api/telnet/fire-panel/simulate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: normType,
        raw: rawMessage,
        location,
        device: deviceType,
        status,
        deviceAddress,
      }),
    });
    if (res.ok) {
      serverSimulated = true;
    }
  } catch {
    // server might be offline or using direct simulation
  }

  // 2. Direct client fallback / reinforcement if SSE is not active
  if (!serverSimulated) {
    try {
      // Append to category list document ({fire/trouble/supervisory}-list)
      await appendLiveLogToCategoryList(label, {
        ...entry,
        deviceAddress,
        fullAddress: deviceAddress,
        time: timeMs,
        timestamp: timestampIso,
        panelTimeText,
      });

      // Record to history document (liveFire / liveTrouble / liveSupervisory)
      const listHistoryItem = [deviceAddress, location, deviceType, statusToken]
        .filter(Boolean)
        .join("   ");

      await recordLiveAlarmToHistory(label, {
        listItem: listHistoryItem,
        raw: rawMessage,
        deviceAddress,
        time: timeMs,
        timestamp: timestampIso,
      });

      // Update in-memory store
      if (deviceAddress) {
        useAssetFireStatusStore
          .getState()
          .optimisticallySetFlagForAddresses([deviceAddress], simplexFlag, 1);
      }

      // Dispatch window events for immediate UI reaction
      if (typeof window !== "undefined") {
        if (normType === "fire") {
          window.dispatchEvent(new CustomEvent("vision365:newFireEvent", { detail: entry }));
        } else if (normType === "trouble") {
          window.dispatchEvent(new CustomEvent("vision365:newTroubleEvent", { detail: entry }));
        } else if (normType === "supervisory") {
          window.dispatchEvent(new CustomEvent("vision365:newSupervisoryEvent", { detail: entry }));
        }
      }
    } catch (err) {
      console.error("[debugSimulation] Direct simulation fallback failed:", err);
    }
  }

  // Also dispatch window event on client even if serverSimulated succeeded (for immediate local sound/modal)
  if (typeof window !== "undefined") {
    if (normType === "fire") {
      window.dispatchEvent(new CustomEvent("vision365:newFireEvent", { detail: entry }));
    } else if (normType === "trouble") {
      window.dispatchEvent(new CustomEvent("vision365:newTroubleEvent", { detail: entry }));
    } else if (normType === "supervisory") {
      window.dispatchEvent(new CustomEvent("vision365:newSupervisoryEvent", { detail: entry }));
    }
  }

  console.log(`[debugSimulation] Simulated new ${label} message for demo device ${deviceAddress}`);
  return entry;
}

// Attach to global window object in browser for quick manual testing / triggers
if (typeof window !== "undefined") {
  window.simulateDebugMessage = simulateDebugMessage;
  window.simulateFireAlarm = () => simulateDebugMessage("fire");
  window.simulateTroubleAlarm = () => simulateDebugMessage("trouble");
  window.simulateSupervisoryAlarm = () => simulateDebugMessage("supervisory");
}
