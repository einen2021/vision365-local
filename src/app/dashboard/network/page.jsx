"use client";

import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Network,
  Plug,
  Flame,
  AlertTriangle,
  Eye,
  Unplug,
  Radio,
} from "lucide-react";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { normalizeDeviceAddress } from "@/lib/assetFireStatus";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

const PANEL_STATE_REFRESH_MS = 5000;
const MONITOR_INTERVAL_MS = 1000;

const CVAL_COMMANDS = [
  { label: "Fire", cmd: "cshow a0 cval", field: "totalFire", listCmd: "list f" },
  {
    label: "Supervisory",
    cmd: "cshow a1 cval",
    field: "totalSupervisory",
    listCmd: "list s",
  },
  { label: "Trouble", cmd: "cshow a2 cval", field: "totalTrouble", listCmd: "list t" },
];

const LIST_COMMAND_TIMEOUT_MS = 15000;

function isListResponseComplete(response) {
  return /_DNE/i.test(String(response));
}

function parseCVal(response) {
  const match = String(response).match(/CVAL=(\d+)/i);
  return match ? Number(match[1]) : null;
}



function extractCVal(response) {
  const regex =
    /^-?\s*(cshow a([012]) cval)\r?\n+\r?~A\2\s*\r?\n+CVAL=(\d+)\r?\n+-?\s*$/i;

  const match = response.trim().match(regex);

  if (!match) {
    return null;
  }

  return {
    command: match[1].toLowerCase(),
    panel: Number(match[2]),
    cval: Number(match[3]),
  };
}

function responseHasCVal(response) {
  return /CVAL=\d+/i.test(String(response));
}

/** Map monitor category label to simplexStatus key (F / T / S). */
function simplexKeyForCategoryLabel(label) {
  if (label === "Trouble") return "T";
  if (label === "Supervisory") return "S";
  return "F";
}

function readSimplexStatus(asset) {
  const raw = asset?.simplexStatus;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      F: Number(raw.F ?? 0),
      T: Number(raw.T ?? 0),
      S: Number(raw.S ?? 0),
    };
  }
  return { F: 0, T: 0, S: 0 };
}

const COMMAND_PLACEHOLDER = "cshow a0 cval";

function AlarmCard({ title, icon: Icon, total, register, tone, lastSync }) {
  const active = total > 0;
  const toneClasses = {
    fire: "border-red-500/40 bg-red-500/5",
    trouble: "border-yellow-500/40 bg-yellow-500/5",
    supervisory: "border-purple-500/40 bg-purple-500/5",
  };

  return (
    <Card className={active ? toneClasses[tone] : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className={`h-4 w-4 ${active ? "" : "text-muted-foreground"}`} />
            {title}
          </CardTitle>
          <Badge variant={active ? "destructive" : "secondary"}>{total}</Badge>
        </div>
        <CardDescription>
          {active ? "Active alarms detected" : "No active alarms"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div>
          <p className="mb-1 font-medium text-muted-foreground">CVAL ({register})</p>
          <p className="rounded border bg-muted/40 p-2 font-mono text-lg font-semibold">
            {total}
          </p>
          {lastSync ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Synced {new Date(lastSync).toLocaleString()}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function NetworkTelnetPage() {
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();

  const host = useFirePanelStore((s) => s.host);
  const port = useFirePanelStore((s) => s.port);
  const setHost = useFirePanelStore((s) => s.setHost);
  const setPort = useFirePanelStore((s) => s.setPort);
  const connected = useFirePanelStore((s) => s.connected);
  const connectedHost = useFirePanelStore((s) => s.connectedHost);
  const connectedPort = useFirePanelStore((s) => s.connectedPort);
  const connectedAt = useFirePanelStore((s) => s.connectedAt);
  const lastError = useFirePanelStore((s) => s.lastError);
  const loading = useFirePanelStore((s) => s.loading);
  const rawResponse = useFirePanelStore((s) => s.rawResponse);
  const connect = useFirePanelStore((s) => s.connect);
  const disconnect = useFirePanelStore((s) => s.disconnect);
  const sendCommand = useFirePanelStore((s) => s.sendCommand);

  const [command, setCommand] = useState("");
  const [panelState, setPanelState] = useState(null);
  const [panelStateLoading, setPanelStateLoading] = useState(true);
  const [monitoring, setMonitoring] = useState(false);
  const [monitorLogs, setMonitorLogs] = useState([]);
  const monitoringRef = useRef(false);
  const panelStateRef = useRef(null);

  const appendMonitorLog = (line) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${line}`;
    setMonitorLogs((prev) => [...prev.slice(-299), entry]);
  };

  const sendPanelCommand = async (cmd, timeoutMs = 3000) => {
    const res = await apiFetch("/api/telnet/fire-panel/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd, timeoutMs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Command failed");
    return data.response || "";
  };

  /** Send a list command and block until the panel response is received. */
  const sendListCommandAndWait = async (listCmd) => {
    appendMonitorLog(`>> ${listCmd} (waiting for response...)`);
    const response = await sendPanelCommand(listCmd, LIST_COMMAND_TIMEOUT_MS);
    if (!isListResponseComplete(response)) {
      appendMonitorLog(`!! ${listCmd}: response incomplete (no _DNE)`);
    } else {
      appendMonitorLog(`<< ${listCmd} complete (${response.length} chars)`);
    }
    return response;
  };

  const savePanelState = async (counts) => {
    const res = await apiFetch("/api/telnet/fire-panel/panel-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(counts),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save panel state");
    if (!data.unchanged) {
      setPanelState(data);
      panelStateRef.current = data;
    }
    return data;
  };

  const runMonitorLoop = async () => {
    while (monitoringRef.current) {
      const counts = {
        totalFire: 0,
        totalSupervisory: 0,
        totalTrouble: 0,
      };

      for (const { label, cmd, field } of CVAL_COMMANDS) {
        if (!monitoringRef.current) break;
        appendMonitorLog(`>> ${label}: ${cmd}`);
        const previousCounts = panelStateRef.current ?? {
          totalFire: 0,
          totalSupervisory: 0,
          totalTrouble: 0,
        };
        try {
          const response = await sendPanelCommand(cmd);
          // if (responseHasCVal(response)) {
          //   console.log(`[fire-panel monitor] ${cmd}: response contains CVAL`);
          // } else {
          //   console.warn(
          //     `[fire-panel monitor] ${cmd}: response does NOT contain CVAL`,
          //     response,
          //   );
          // }

          const parsed = extractCVal(response);
          
          const cval = parsed?.cval;
          if (cval === null) {
            counts[field] = previousCounts[field] ?? 0;
            appendMonitorLog(
              `!! ${label}: CVAL not parsed — keeping ${counts[field]} (${response.trim() || "(empty)"})`,
            );
          } else {
            counts[field] = cval;
            appendMonitorLog(
              `<< ${response.trim() || "(empty)"} (CVAL=${counts[field]})`,
            );
          }
        } catch (error) {
          counts[field] = previousCounts[field] ?? 0;
          appendMonitorLog(
            `!! ${label}: ${error.message} — keeping ${counts[field]}`,
          );
          console.error(`[fire-panel monitor] ${cmd} failed:`, error);
        }
      }

      if (!monitoringRef.current) break;

      const previous = panelStateRef.current ?? {
        totalFire: 0,
        totalSupervisory: 0,
        totalTrouble: 0,
      };
      const incrementedValues = CVAL_COMMANDS.filter(
        ({ field }) => counts[field] > previous[field],
      );

      console.log(`[fire-panel monitor] incrementedValues:`, incrementedValues);

      try {
        const saved = await savePanelState(counts);
        if (saved.unchanged) {
          appendMonitorLog("DB firePanelState unchanged — skip write");
        } else {
          appendMonitorLog(
            `DB firePanelState → fire=${saved.totalFire} supervisory=${saved.totalSupervisory} trouble=${saved.totalTrouble}`,
          );

          for (const { label, listCmd } of incrementedValues) {
            if (!monitoringRef.current) break;
            appendMonitorLog(`>> ${label} changed — ${listCmd}`);
            try {
              const listResponse = await sendListCommandAndWait(listCmd);
              console.log(`[fire-panel monitor] ${listCmd}:`, listResponse);

              const regex = /\b\d+:M\d+-\d+-\d+\b/g;
              const deviceAddresses = listResponse.match(regex) ?? [];
              console.log(`[ADD - extracted addresses] ${listCmd} addresses:`, deviceAddresses);
              const statusKey = simplexKeyForCategoryLabel(label);
              const panelAddressSet = new Set(
                deviceAddresses.map((addr) => normalizeDeviceAddress(addr)),
              );

              const snapshot = await getDocs(collection(db, "AssetsList"));
              let updatedCount = 0;

              for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                const assetAddress = normalizeDeviceAddress(
                  resolveAssetDeviceAddress(data) || data.deviceAddress || "",
                );
                if (!panelAddressSet.has(assetAddress)) continue;

                const current = readSimplexStatus(data);
                if (Number(current[statusKey]) === 1) continue;

                const next = { ...current, [statusKey]: 1 };
                await updateDoc(doc(db, "AssetsList", docSnap.id), {
                  simplexStatus: next,
                  updatedAt: new Date().toISOString(),
                });
                updatedCount += 1;
              }

              if (updatedCount > 0) {
                appendMonitorLog(
                  `AssetsList updated ${updatedCount} asset(s) → ${statusKey}=1 (${label})`,
                );
                await useAssetFireStatusStore.getState().syncFromAssetsList();
              }
            } catch (error) {
              appendMonitorLog(`!! ${listCmd} failed: ${error.message}`);
              console.error(`[fire-panel monitor] ${listCmd} failed:`, error);
            }
          }
        }
      } catch (error) {
        appendMonitorLog(`!! save failed: ${error.message}`);
      }

      await new Promise((r) => setTimeout(r, MONITOR_INTERVAL_MS));
    }
  };

  const stopMonitoring = () => {
    monitoringRef.current = false;
    setMonitoring(false);
    appendMonitorLog("--- stopped ---");
  };

  const handleMonitorData = () => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the panel first",
        variant: "destructive",
      });
      return;
    }

    if (monitoring) {
      stopMonitoring();
      return;
    }

    monitoringRef.current = true;
    setMonitoring(true);
    appendMonitorLog("--- started ---");
    void runMonitorLoop();
  };

  useEffect(() => {
    return () => {
      monitoringRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!connected && monitoring) {
      stopMonitoring();
    }
  }, [connected, monitoring]);

  const fetchPanelState = async () => {
    try {
      const res = await apiFetch("/api/telnet/fire-panel/panel-state");
      if (!res.ok) return;
      const data = await res.json();
      setPanelState(data);
      panelStateRef.current = data;
    } catch {
      // API may be unavailable on first load
    } finally {
      setPanelStateLoading(false);
    }
  };

  useEffect(() => {
    fetchPanelState();
    const timer = setInterval(fetchPanelState, PANEL_STATE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const displayTotals = {
    fire: panelState?.totalFire ?? 0,
    trouble: panelState?.totalTrouble ?? 0,
    supervisory: panelState?.totalSupervisory ?? 0,
  };
  const lastPanelSync = panelState?.lastPanelSync ?? null;

  const handleConnect = async () => {
    const result = await connect();
    if (result.ok) {
      toast({
        title: "Connected",
        description: `Connected to ${host.trim()}:${port}`,
      });
    }
  };

  const handleDisconnect = async () => {
    stopMonitoring();
    const result = await disconnect();
    if (result.ok) {
      toast({ title: "Disconnected", description: "Session closed" });
    }
  };

  const handleManualCommand = async () => {
    if (!command.trim()) return;
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the panel first",
        variant: "destructive",
      });
      return;
    }
    await sendCommand(command);
  };

  const isConnected = connected;

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Network Telnet</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            {monitoring ? (
              <Badge variant="outline" className="border-blue-500/50 text-blue-600">
                Monitoring
              </Badge>
            ) : null}
            {isConnected ? (
              <Badge variant="outline" className="border-green-500/50 text-green-600">
                Connected {connectedHost}:{connectedPort}
              </Badge>
            ) : (
              <Badge variant="secondary">Disconnected</Badge>
            )}
            <ModeToggle />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <div className="flex items-center gap-2">
            <Network className="h-6 w-6" />
            <div>
              <h1 className="text-2xl font-semibold">Fire Panel Network</h1>
              <p className="text-sm text-muted-foreground">
                Connect to the panel and send manual telnet commands
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Connection</CardTitle>
                <CardDescription>
                  Only one panel connection allowed at a time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="host">IP address</Label>
                  <Input
                    id="host"
                    placeholder="192.168.100.1"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    disabled={loading || isConnected}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    disabled={loading || isConnected}
                  />
                </div>

                {!isConnected ? (
                  <Button
                    className="w-full"
                    onClick={handleConnect}
                    disabled={loading || !host.trim()}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Plug className="mr-2 h-4 w-4" />
                        Connect
                      </>
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      className="w-full"
                      type="button"
                      variant={monitoring ? "outline" : "default"}
                      onClick={handleMonitorData}
                      disabled={loading}
                    >
                      <Radio className="mr-2 h-4 w-4" />
                      {monitoring ? "Stop Monitoring" : "Monitor Data"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={handleDisconnect}
                      disabled={loading}
                    >
                      <Unplug className="mr-2 h-4 w-4" />
                      Disconnect
                    </Button>
                  </>
                )}

                {isConnected && connectedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Session since {new Date(connectedAt).toLocaleString()}
                  </p>
                ) : null}

                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Manual command examples</p>
                  <p>cshow a0 cval</p>
                  <p>list f</p>
                  <p>list t</p>
                  <p>list s</p>
                </div>
              </CardContent>
            </Card>

            <div className="lg:col-span-2 space-y-4">
              {lastError ? (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{lastError}</AlertDescription>
                </Alert>
              ) : null}

              {lastPanelSync ? (
                <p className="text-xs text-muted-foreground">
                  Last firePanelState sync:{" "}
                  {new Date(lastPanelSync).toLocaleString()}
                </p>
              ) : null}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Log console</CardTitle>
                  <CardDescription>
                    CVAL monitor output (a0 fire, a1 supervisory, a2 trouble)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {monitorLogs.length > 0 ? (
                    <pre className="max-h-56 overflow-auto rounded border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
                      {monitorLogs.join("\n")}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Click Monitor Data to start reading CVAL registers.
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {panelStateLoading
                    ? "Loading firePanelState from database..."
                    : "Panel CVAL totals from firePanelState"}
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <AlarmCard
                    title="Fire"
                    icon={Flame}
                    register="a0"
                    total={displayTotals.fire}
                    tone="fire"
                    lastSync={lastPanelSync}
                  />
                  <AlarmCard
                    title="Supervisory"
                    icon={Eye}
                    register="a1"
                    total={displayTotals.supervisory}
                    tone="supervisory"
                    lastSync={lastPanelSync}
                  />
                  <AlarmCard
                    title="Trouble"
                    icon={AlertTriangle}
                    register="a2"
                    total={displayTotals.trouble}
                    tone="trouble"
                    lastSync={lastPanelSync}
                  />
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Manual command</CardTitle>
                  <CardDescription>
                    Enter a command (connect first)
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    placeholder={COMMAND_PLACEHOLDER}
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    disabled={loading || !isConnected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !loading) handleManualCommand();
                    }}
                  />
                  <Button
                    variant="secondary"
                    onClick={handleManualCommand}
                    disabled={loading || !command.trim() || !isConnected}
                  >
                    Send
                  </Button>
                </CardContent>
                {rawResponse ? (
                  <CardContent className="pt-0">
                    <pre className="max-h-48 overflow-auto rounded border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
                      {rawResponse}
                    </pre>
                  </CardContent>
                ) : null}
              </Card>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
