"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye, Flame, Loader2, RefreshCcw } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  extractPanelDeviceAddresses,
  formatPanelListTime,
  getExpectedListCountForLabel,
  isListResponseReady,
  parsePanelListResponse,
  syncPanelListWithTempArray,
} from "@/lib/firePanelMonitor";
import {
  silenceSupervisoryAlertBeep,
  silenceTroubleAlertBeep,
} from "@/lib/troubleAlertBeep";
import { cn } from "@/lib/utils";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import { acknowledgeDevice, sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";
import { findAssetsListEntryByPanelAddress } from "@/lib/assetsListSimplexStatus";
import { resolveAssetNavigationUrl } from "@/lib/assetPlacementNavigation";
import { saveListToCategoryDb } from "@/lib/recordAlarmHistory";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import {
  deferForFirePriority,
  firePriorityHoldMessage,
  isHeldByFirePriority,
} from "@/lib/firePriority";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelAlarmList } from "@/components/live-panel/panel-alarm-list";
import { apiFetch, apiUrl } from "@/lib/apiClient";

const PAGE_ICONS = {
  Fire: Flame,
  Trouble: AlertTriangle,
  Supervisory: Eye,
};

const TONE_CLASSES = {
  fire: "text-red-600",
  trouble: "text-yellow-700",
  supervisory: "text-purple-600",
};

const EMPTY_LABELS = {
  Fire: "No active fire alarms.",
  Trouble: "No active troubles.",
  Supervisory: "No active supervisory alarms.",
};

const LIST_CMD_BY_LABEL = {
  Fire: "list f",
  Trouble: "list t",
  Supervisory: "list s",
};

const CATEGORY_BY_LABEL = {
  Fire: "fire",
  Trouble: "trouble",
  Supervisory: "supervisory",
};

/** Shared wrapper component for live panel list pages. */
export function LivePanelListPage({ label, title, description, tone }) {
  const router = useRouter();
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const connected = useFirePanelStore((s) => s.connected);
  const {
    firePanelListResponses,
    firePanelState,
  } = useFirePanelMonitor();

  const {
    troubleModalEnabled,
    supervisoryModalEnabled,
    setTroubleModalEnabled,
    setSupervisoryModalEnabled,
  } = useLivePanelAlert();

  const alertModalEnabled =
    label === "Trouble"
      ? troubleModalEnabled
      : label === "Supervisory"
        ? supervisoryModalEnabled
        : null;

  const handleAlertToggle = (enabled) => {
    if (label === "Trouble") setTroubleModalEnabled(enabled);
    if (label === "Supervisory") setSupervisoryModalEnabled(enabled);
  };

  const [acknowledgingAddress, setAcknowledgingAddress] = useState(null);
  const [ackedAddresses, setAckedAddresses] = useState(() => new Set());
  const [dbListRows, setDbListRows] = useState([]);
  const [dbFetchedAt, setDbFetchedAt] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const Icon = PAGE_ICONS[label] || Flame;
  const cached = firePanelListResponses?.[label] ?? null;
  const rawResponse = cached?.response || "";
  const fetchedAt = dbFetchedAt || cached?.fetchedAt || "";
  const newestAddress = cached?.newestAddress || "";

  // Real-time Firestore snapshot listener for the category DB ({fire/trouble/supervisory}-list)
  useEffect(() => {
    const docName = `${label.toLowerCase()}-list`;
    const unsub = onSnapshot(
      doc(db, docName, "current"),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (Array.isArray(data?.rows)) {
            setDbListRows(data.rows);
            if (data.updatedAt) setDbFetchedAt(data.updatedAt);
          } else {
            setDbListRows([]);
          }
        } else {
          setDbListRows([]);
        }
      },
      (err) => {
        console.error(`[LivePanelListPage] Error listening to ${docName}:`, err);
      },
    );

    return () => unsub();
  }, [label]);

  const parsedRows = useMemo(() => {
    if (dbListRows.length > 0) return dbListRows;
    if (cached?.rows && cached.rows.length > 0) return cached.rows;
    return rawResponse
      ? syncPanelListWithTempArray(label, rawResponse, fetchedAt || new Date().toISOString())
      : [];
  }, [dbListRows, cached?.rows, rawResponse, fetchedAt, label]);

  const responseTimeLabel = useMemo(
    () => formatPanelListTime(fetchedAt) || "",
    [fetchedAt],
  );

  const highlightedAddresses = useMemo(() => {
    const newest = String(newestAddress || "").trim();
    return newest ? new Set([newest]) : new Set();
  }, [newestAddress]);

  const isStreaming = isRefreshing || Boolean(cached?.streaming);
  const expectedCount = getExpectedListCountForLabel(label, firePanelState);
  const listComplete =
    !isStreaming &&
    (isListResponseReady(rawResponse, expectedCount) || parsedRows.length > 0);
  const listMessageCount = parsedRows.length || (rawResponse ? countListMessages(rawResponse) : 0);

  const emptyLabel = EMPTY_LABELS[label] || "No active entries.";

  const handleRowAck = useCallback(
    async (row) => {
      if (!connected || acknowledgingAddress) return;

      const address = String(row.fullAddress || row.deviceAddress || "").trim();
      if (!address) {
        toast({
          title: "Missing address",
          description: "This list row has no device address to acknowledge.",
          variant: "destructive",
        });
        return;
      }

      setAcknowledgingAddress(address);
      try {
        if (label === "Trouble") {
          silenceTroubleAlertBeep();
        }
        if (label === "Supervisory") {
          silenceSupervisoryAlertBeep();
        }

        await acknowledgeDevice(label, address);

        setAckedAddresses((prev) => {
          const next = new Set(prev);
          next.add(row.fullAddress);
          return next;
        });

        toast({
          title: "Acknowledged",
          description: `ack ${label === "Fire" ? "f" : label === "Trouble" ? "t" : "s"} ${address}`,
        });

        if (label === "Fire") {
          const entry = await findAssetsListEntryByPanelAddress(address);
          if (!entry) {
            toast({
              title: "Asset not found",
              description: `No AssetsList entry for ${address}.`,
              variant: "destructive",
            });
          } else {
            const asset = { id: entry.id, ...entry.data };
            const url = await resolveAssetNavigationUrl(asset, entry.id);
            const parsed = new URL(url, window.location.origin);
            if (entry.id) parsed.searchParams.set("assetId", entry.id);
            parsed.searchParams.set("address", address);
            router.push(`${parsed.pathname}?${parsed.searchParams.toString()}`);
            return;
          }
        }
      } catch (error) {
        toast({
          title: "Acknowledge failed",
          description: error?.message || "Could not acknowledge this entry.",
          variant: "destructive",
        });
      } finally {
        setAcknowledgingAddress(null);
      }
    },
    [
      acknowledgingAddress,
      connected,
      label,
      router,
      toast,
    ],
  );

  const refreshList = useCallback(async () => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before requesting a list command.",
        variant: "destructive",
      });
      return;
    }

    // Fire first: no `list t` / `list s` while FIRE > 0.
    if (isHeldByFirePriority(label)) {
      deferForFirePriority(label);
      toast({ title: "Fire alarm active", description: firePriorityHoldMessage(label) });
      return;
    }

    const cmd = LIST_CMD_BY_LABEL[label] || "list f";
    setIsRefreshing(true);
    try {
      const res = await sendPriorityPanelCommand(cmd, 25000);
      if (isHeldByFirePriority(label)) {
        deferForFirePriority(label);
        throw new Error(firePriorityHoldMessage(label));
      }
      const rows = parsePanelListResponse(res);
      const addresses = extractPanelDeviceAddresses(res);

      syncPanelListWithTempArray(label, rows);
      await saveListToCategoryDb(label, rows);
      void syncAssetsListWithPanelList(label, addresses);

      toast({
        title: "List refreshed",
        description: `${rows.length} ${label.toLowerCase()} entries updated.`,
      });
    } catch (error) {
      toast({
        title: "List command failed",
        description: error?.message || "Could not fetch panel list response.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [connected, label, toast]);

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
              <PanelAlarmList pending={true} tone={tone} />
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
              <Icon className={cn("h-6 w-6", TONE_CLASSES[tone])} />
              <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {alertModalEnabled !== null ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Switch
                    id={`${label}-page-alert-enabled`}
                    checked={alertModalEnabled}
                    onCheckedChange={handleAlertToggle}
                  />
                  <Label
                    htmlFor={`${label}-page-alert-enabled`}
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Popup alerts
                  </Label>
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!connected || isStreaming}
                onClick={() => void refreshList()}
              >
                {isStreaming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                {isStreaming ? "Receiving list..." : "Refresh list"}
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
                emptyLabel={emptyLabel}
                pending={isStreaming && parsedRows.length === 0}
                tone={tone}
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
