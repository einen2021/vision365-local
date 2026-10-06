"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import {
  countListMessages,
  extractPanelDeviceAddresses,
  formatPanelListTime,
  getExpectedListCountForLabel,
  isListResponseReady,
  parsePanelListResponse,
  syncPanelListWithTempArray,
  getTempPanelList,
} from "@/lib/firePanelMonitor";
import { silenceTroubleAlertBeep } from "@/lib/troubleAlertBeep";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import { acknowledgeDevice, sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";
import { withMonitorPaused } from "@/lib/firePanelMonitorSession";
import { refreshCategoryPanelList } from "@/lib/refreshCategoryList";
import { findAssetsListEntryByPanelAddress } from "@/lib/assetsListSimplexStatus";
import { resolveAssetNavigationUrl } from "@/lib/assetPlacementNavigation";
import { stampFloorPlanNavigationParams } from "@/lib/fireAlertFloorNavigation";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelAlarmList } from "@/components/live-panel/panel-alarm-list";

function isShowCountsOrSystem(entry) {
  if (!entry) return true;
  if (entry.kind === "system" || entry.kind === "cval") return true;
  const raw = String(entry.raw || "");
  const loc = String(entry.location || "");
  const status = String(entry.status || "");
  const desc = String(entry.description || "");

  if (/FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+|PRIORITY2\s*=\s*\d+/i.test(raw)) return true;
  if (/FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+|PRIORITY2\s*=\s*\d+/i.test(loc)) return true;
  if (/^show\s+counts|^show\b|PRIMARY\s+STATUS|ENABLED\s+STATE/i.test(raw)) return true;
  if (/^show\s+counts|^show\b|PRIMARY\s+STATUS|ENABLED\s+STATE/i.test(loc)) return true;
  if (/^show\s+counts|^show\b|PRIMARY\s+STATUS|ENABLED\s+STATE/i.test(desc)) return true;
  if (/SYSTEM\s+RESET|SYSTEM\s+IS\s+NORMAL/i.test(raw) && !entry.pointId && !entry.deviceAddress) return true;
  return false;
}

function isEntryAcked(entry) {
  if (!entry) return false;
  if (entry.acknowledged === true) return true;
  const status = String(entry.status || "").toUpperCase();
  const raw = String(entry.raw || "").toUpperCase();
  return (
    status.includes("ACKED") ||
    status.includes("NORMAL") ||
    raw.includes("ACKED") ||
    raw.includes("NORMAL ACKED") ||
    raw.includes("ACKED AT NODE")
  );
}

export default function LiveTroublePage() {
  const router = useRouter();
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const connected = useFirePanelStore((s) => s.connected);
  const {
    firePanelListResponses,
    firePanelState,
  } = useFirePanelMonitor();

  const { troubleModalEnabled, setTroubleModalEnabled } = useLivePanelAlert();

  const [acknowledgingAddress, setAcknowledgingAddress] = useState(null);
  const [ackedAddresses, setAckedAddresses] = useState(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setTick] = useState(0);
  const [dbListRows, setDbListRows] = useState([]);
  const [dbListLoaded, setDbListLoaded] = useState(false);
  const [dbFetchedAt, setDbFetchedAt] = useState("");

  const handleRefresh = useCallback(async () => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before refreshing the list.",
        variant: "destructive",
      });
      return;
    }

    setIsRefreshing(true);
    try {
      const { rows, expectedCount } = await refreshCategoryPanelList("Trouble");

      toast({
        title: "List Refreshed",
        description: `${rows.length}${expectedCount > 0 ? `/${expectedCount}` : ""} trouble ${rows.length === 1 ? "entry" : "entries"} updated.`,
      });
    } catch (error) {
      console.error("[LiveTroublePage] refresh list failed:", error);
      toast({
        title: "Refresh failed",
        description: error?.message || "Could not refresh trouble list from panel.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [connected, toast]);

  const cached = firePanelListResponses?.Trouble ?? null;
  const rawResponse = typeof cached === "string" ? cached : (cached?.response || "");
  const fetchedAt = dbFetchedAt || cached?.fetchedAt || "";
  const newestAddress = cached?.newestAddress || "";

  // Listen to fire panel updates to keep live list in sync
  useEffect(() => {
    const handleUpdate = () => setTick((t) => t + 1);
    if (typeof window !== "undefined") {
      window.addEventListener("vision365:firePanelStateUpdated", handleUpdate);
      return () => {
        window.removeEventListener("vision365:firePanelStateUpdated", handleUpdate);
      };
    }
  }, []);

  // Real-time Firestore listener for the trouble-list document — reflects
  // every write (startup sync, live panel events, acks) across all clients instantly.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "trouble-list", "current"),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setDbListRows(Array.isArray(data?.rows) ? data.rows : []);
          if (data?.updatedAt) setDbFetchedAt(data.updatedAt);
        } else {
          setDbListRows([]);
        }
        setDbListLoaded(true);
      },
      (err) => {
        console.error("[LiveTroublePage] Error listening to trouble-list:", err);
        setDbListLoaded(true);
      },
    );
    return () => unsub();
  }, []);

  const parsedRows = useMemo(() => {
    let sourceList = [];
    if (dbListLoaded) {
      // trouble-list is written atomically (single setDoc) once the full list
      // response is confirmed — trust it completely, including a genuinely
      // empty list, instead of the temp cache (which updates before the save
      // completes and would otherwise flash incomplete/in-progress data).
      sourceList = dbListRows;
    } else {
      const tempRows = getTempPanelList("Trouble");
      if (tempRows && tempRows.length > 0) {
        sourceList = tempRows;
      } else if (cached?.rows && cached.rows.length > 0) {
        sourceList = cached.rows;
      } else if (rawResponse) {
        sourceList = syncPanelListWithTempArray("Trouble", rawResponse, fetchedAt || new Date().toISOString());
      }
    }

    const dedupMap = new Map();
    for (const r of sourceList) {
      if (!r) continue;
      if (isShowCountsOrSystem(r)) continue;
      if (isEntryAcked(r)) continue;
      if (
        ackedAddresses.has(r.fullAddress) ||
        ackedAddresses.has(r.deviceAddress) ||
        ackedAddresses.has(r.key) ||
        ackedAddresses.has(r.id)
      ) {
        continue;
      }
      const k = r.fullAddress && r.fullAddress !== "—" ? r.fullAddress : (r.key || r.location || r.id);
      if (k) {
        dedupMap.set(k, r);
      }
    }

    return Array.from(dedupMap.values());
  }, [dbListLoaded, dbListRows, cached?.rows, rawResponse, fetchedAt, ackedAddresses]);

  const responseTimeLabel = useMemo(
    () => formatPanelListTime(fetchedAt) || "",
    [fetchedAt],
  );

  const highlightedAddresses = useMemo(() => {
    const newest = String(newestAddress || "").trim();
    return newest ? new Set([newest]) : new Set();
  }, [newestAddress]);

  const isStreaming = Boolean(cached?.streaming);
  const expectedCount = getExpectedListCountForLabel("Trouble", firePanelState);
  const listComplete =
    !isStreaming &&
    (isListResponseReady(rawResponse, expectedCount) || parsedRows.length > 0);
  const listMessageCount = parsedRows.length || (rawResponse ? countListMessages(rawResponse) : 0);

  /** Resolve the row's asset and navigate to it, highlighted, on its nested floor plan. */
  const navigateToAssetOnFloorPlan = useCallback(
    async (address) => {
      if (!address || address === "—") return;
      try {
        const entry = await findAssetsListEntryByPanelAddress(address);
        if (!entry) return;
        const asset = { id: entry.id, ...entry.data };
        const url = await resolveAssetNavigationUrl(asset, entry.id);
        router.push(
          stampFloorPlanNavigationParams(url, {
            assetId: entry.id,
            address,
            highlight: true,
          }),
        );
      } catch (error) {
        console.error("[LiveTroublePage] navigate to floor plan failed:", error);
      }
    },
    [router],
  );

  const handleRowAck = useCallback(
    async (row) => {
      const address = String(row.fullAddress || row.deviceAddress || "").trim();

      // Navigate + highlight right away — this should work regardless of panel
      // connection state or whether the acknowledge below succeeds.
      void navigateToAssetOnFloorPlan(address);

      if (!connected || acknowledgingAddress) return;

      const targetKey = address !== "—" ? address : (row.key || row.id);
      setAcknowledgingAddress(targetKey);
      try {
        silenceTroubleAlertBeep();
        // await acknowledgeDevice("Trouble", address);

        // setAckedAddresses((prev) => {
        //   const next = new Set(prev);
        //   next.add(row.fullAddress);
        //   next.add(row.deviceAddress);
        //   next.add(row.key);
        //   next.add(row.id);
        //   return next;
        // });

        // toast({
        //   title: "Acknowledged",
        //   description: `ack t ${address !== "—" ? address : ""}`,
        // });
      } catch (error) {
        // toast({
        //   title: "Acknowledge failed",
        //   description: error?.message || "Could not acknowledge this entry.",
        //   variant: "destructive",
        // });
      } finally {
        setAcknowledgingAddress(null);
      }
    },
    [acknowledgingAddress, connected, navigateToAssetOnFloorPlan],
  );

  if (!isReady) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DashboardTopBar headerClassName="flex h-16 shrink-0 items-center gap-2 border-b px-4" />
          <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <div className="flex-1">
              <PanelAlarmList pending={true} tone="trouble" />
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardTopBar headerClassName="flex h-16 shrink-0 items-center gap-2 border-b px-4" />

        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-yellow-700" />
              <div>
                <h1 className="text-2xl font-semibold">Live Trouble</h1>
                <p className="text-sm text-muted-foreground">
                  Latest trouble list from the fire panel
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Switch
                  id="trouble-page-alert-enabled"
                  checked={troubleModalEnabled}
                  onCheckedChange={setTroubleModalEnabled}
                />
                <Label
                  htmlFor="trouble-page-alert-enabled"
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  Popup alerts
                </Label>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefresh()}
                disabled={!connected || isRefreshing}
                className="gap-1.5"
              >
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>

          {!connected ? (
            <p className="shrink-0 text-sm text-muted-foreground">
              Connect to the fire panel to load the latest list.
            </p>
          ) : (
            <div className="min-h-0 flex-1">
              {isStreaming && parsedRows.length > 0 ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  Streaming panel response — {parsedRows.length}
                  {expectedCount != null ? `/${expectedCount}` : ""} row
                  {parsedRows.length === 1 ? "" : "s"} so far
                </p>
              ) : null}
              <PanelAlarmList
                rows={parsedRows}
                emptyLabel="No active troubles."
                pending={isStreaming && parsedRows.length === 0}
                tone="trouble"
                highlightedAddresses={highlightedAddresses}
                onRowAck={(row) => void handleRowAck(row)}
                acknowledgingAddress={acknowledgingAddress}
                listComplete={listComplete}
                expectedCount={expectedCount}
                listMessageCount={listMessageCount}
                responseTimeLabel={responseTimeLabel}
              />
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
