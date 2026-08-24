"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import {
  countListMessages,
  formatPanelListTime,
  getExpectedListCountForLabel,
  isListResponseReady,
  syncPanelListWithTempArray,
  getTempPanelList,
} from "@/lib/firePanelMonitor";
import { silenceSupervisoryAlertBeep } from "@/lib/troubleAlertBeep";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import { acknowledgeDevice } from "@/lib/acknowledgePanelDevice";
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
  if (/^show\s+counts/i.test(raw) || /^show\s+counts/i.test(loc) || /^show\s+counts/i.test(desc)) return true;
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

export default function LiveSupervisoryPage() {
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const connected = useFirePanelStore((s) => s.connected);
  const {
    firePanelListResponses,
    firePanelState,
  } = useFirePanelMonitor();

  const { supervisoryModalEnabled, setSupervisoryModalEnabled } =
    useLivePanelAlert();

  const [acknowledgingAddress, setAcknowledgingAddress] = useState(null);
  const [ackedAddresses, setAckedAddresses] = useState(() => new Set());
  const [, setTick] = useState(0);
  const [dbListRows, setDbListRows] = useState([]);
  const [dbListLoaded, setDbListLoaded] = useState(false);
  const [dbFetchedAt, setDbFetchedAt] = useState("");

  const cached = firePanelListResponses?.Supervisory ?? null;
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

  // Real-time Firestore listener for the supervisory-list document — reflects
  // every write (startup sync, live panel events, acks) across all clients instantly.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "supervisory-list", "current"),
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
        console.error("[LiveSupervisoryPage] Error listening to supervisory-list:", err);
        setDbListLoaded(true);
      },
    );
    return () => unsub();
  }, []);

  const parsedRows = useMemo(() => {
    let sourceList = [];
    if (dbListLoaded) {
      // supervisory-list is written atomically (single setDoc) once the full
      // list response is confirmed — trust it completely, including a
      // genuinely empty list, instead of the temp cache (which updates before
      // the save completes and would otherwise flash incomplete data).
      sourceList = dbListRows;
    } else {
      const tempRows = getTempPanelList("Supervisory");
      if (tempRows && tempRows.length > 0) {
        sourceList = tempRows;
      } else if (cached?.rows && cached.rows.length > 0) {
        sourceList = cached.rows;
      } else if (rawResponse) {
        sourceList = syncPanelListWithTempArray("Supervisory", rawResponse, fetchedAt || new Date().toISOString());
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
  const expectedCount = getExpectedListCountForLabel("Supervisory", firePanelState);
  const listComplete =
    !isStreaming &&
    (isListResponseReady(rawResponse, expectedCount) || parsedRows.length > 0);
  const listMessageCount = parsedRows.length || (rawResponse ? countListMessages(rawResponse) : 0);

  const handleRowAck = useCallback(
    async (row) => {
      if (!connected || acknowledgingAddress) return;

      const address = String(row.fullAddress || row.deviceAddress || "").trim();
      const targetKey = address !== "—" ? address : (row.key || row.id);
      setAcknowledgingAddress(targetKey);
      try {
        silenceSupervisoryAlertBeep();
        await acknowledgeDevice("Supervisory", address);

        setAckedAddresses((prev) => {
          const next = new Set(prev);
          next.add(row.fullAddress);
          next.add(row.deviceAddress);
          next.add(row.key);
          next.add(row.id);
          return next;
        });

        toast({
          title: "Acknowledged",
          description: `ack s ${address !== "—" ? address : ""}`,
        });
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
    [acknowledgingAddress, connected, toast],
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
              <PanelAlarmList pending={true} tone="supervisory" />
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
              <Eye className="h-6 w-6 text-purple-600" />
              <div>
                <h1 className="text-2xl font-semibold">Live Supervisory</h1>
                <p className="text-sm text-muted-foreground">
                  Latest supervisory list from the fire panel
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Switch
                  id="supervisory-page-alert-enabled"
                  checked={supervisoryModalEnabled}
                  onCheckedChange={setSupervisoryModalEnabled}
                />
                <Label
                  htmlFor="supervisory-page-alert-enabled"
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  Popup alerts
                </Label>
              </div>
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
                emptyLabel="No active supervisory alarms."
                pending={isStreaming && parsedRows.length === 0}
                tone="supervisory"
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
