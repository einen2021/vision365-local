"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";
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
  Terminal,
  PauseCircle,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFireAlert } from "@/contexts/FireModalContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { DashboardTopBar, DashboardPageContent } from "@/components/dashboard-header";
import { apiUrl } from "@/lib/apiClient";
import { getStoredSessionUser } from "@/lib/sessionUser";

const COMMAND_PLACEHOLDER = "cshow a0 cval";

// ---------------------------------------------------------------------------
// AlarmCard
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Kind metadata
// ---------------------------------------------------------------------------
const KIND_META = {
  fire:                { label: "FIRE",        color: "text-red-400",     bg: "bg-red-950/40",     priority: 0 },
  trouble:             { label: "TRBL",        color: "text-yellow-400",  bg: "bg-yellow-950/30",  priority: 1 },
  supervisory:         { label: "SUPV",        color: "text-purple-400",  bg: "bg-purple-950/30",  priority: 2 },
  "fire-acknowledged": { label: "F-ACK",       color: "text-orange-400",  bg: "bg-orange-950/30",  priority: 3 },
  acknowledged:        { label: "ACK",         color: "text-green-400",   bg: "bg-green-950/30",   priority: 4 },
  "reset-in-progress": { label: "RESET-START", color: "text-blue-400",    bg: "bg-blue-950/30",    priority: 5 },
  "reset-normal":      { label: "SYS-NORMAL",  color: "text-emerald-400", bg: "bg-emerald-950/30", priority: 6 },
  "reset-complete":    { label: "RESET-OK",    color: "text-teal-400",    bg: "bg-teal-950/30",    priority: 7 },
  "reset-aborted":     { label: "RESET-ABORT", color: "text-rose-400",    bg: "bg-rose-950/30",    priority: 8 },
  reset:               { label: "RESET",       color: "text-indigo-400",  bg: "bg-indigo-950/30",  priority: 9 },
  cval:                { label: "CVAL",        color: "text-cyan-400",    bg: "bg-cyan-950/30",    priority: 10 },
  system:              { label: "SYS",         color: "text-blue-400",    bg: "",                  priority: 11 },
  other:               { label: "EVT",         color: "text-slate-400",   bg: "",                  priority: 12 },
  unparsed:            { label: "???",         color: "text-slate-500",   bg: "",                  priority: 13 },
  noise:               { label: "~",           color: "text-slate-600",   bg: "",                  priority: 14 },
};

const REGISTER_LABELS = { a0: "Fire (A0)", a1: "Supervisory (A1)", a2: "Trouble (A2)" };
const MAX_DISPLAY_LOGS = 300;

function formatLogRow(entry) {
  const meta = KIND_META[entry.kind] ?? KIND_META.other;

  // CVAL row
  if (entry.kind === "cval") {
    const reg = REGISTER_LABELS[entry.register] ?? entry.register ?? "?";
    return `${reg}: CVAL = ${entry.cval ?? "?"}`;
  }

  // System Reset rows
  if (
    entry.kind === "reset-in-progress" ||
    entry.kind === "reset-normal" ||
    entry.kind === "reset-complete" ||
    entry.kind === "reset-aborted" ||
    entry.kind === "reset"
  ) {
    const loc = entry.location ? `${entry.location}  |  ` : "";
    return `${loc}${entry.status || entry.description || entry.raw}`;
  }

  // Event rows (fire/trouble/supervisory/acknowledged/other)
  if (entry.location || entry.device || entry.status) {
    const parts = [entry.location, entry.device, entry.status].filter(Boolean);
    return parts.join("  |  ");
  }

  // List entries
  if (entry.pointId) {
    return `[${entry.pointId}] ${entry.description ?? ""} — ${entry.status ?? ""}`;
  }

  // System / fallback
  return entry.raw?.slice(0, 120) ?? "";
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// PanelLogConsole
// ---------------------------------------------------------------------------
function PanelLogConsole({ connected }) {
  const [logs, setLogs] = useState([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("all");
  const [counts, setCounts] = useState({});
  const bottomRef = useRef(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // ── Initial log fetch & continuous real-time SSE stream ───────────────────
  useEffect(() => {
    let active = true;
    let es = null;
    let reconnectTimer = null;

    // 1. Fetch latest logs immediately on mount/re-render so console is never blank
    const fetchInitialLogs = async () => {
      try {
        const url = apiUrl("/api/telnet/fire-panel/logs?limit=200");
        const res = await fetch(url);
        if (!res.ok) return;
        const initial = await res.json();
        if (!active || !Array.isArray(initial)) return;

        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id ?? `${l.raw}-${l.at}`));
          const fresh = initial.filter((l) => !existingIds.has(l.id ?? `${l.raw}-${l.at}`));
          const merged = [...prev, ...fresh];
          return merged.length > MAX_DISPLAY_LOGS ? merged.slice(-MAX_DISPLAY_LOGS) : merged;
        });

        const initialCounts = {};
        initial.forEach((l) => {
          if (l.kind) initialCounts[l.kind] = (initialCounts[l.kind] ?? 0) + 1;
        });
        setCounts((prev) => ({ ...initialCounts, ...prev }));
      } catch {
        // ignore on boot
      }
    };

    fetchInitialLogs();

    // 2. Establish continuous SSE stream with auto-reconnect
    const connectSSE = () => {
      try {
        const streamUrl = apiUrl("/api/telnet/fire-panel/logs/stream");
        es = new EventSource(streamUrl);

        es.onmessage = (e) => {
          if (!active) return;
          try {
            const entry = JSON.parse(e.data);
            if (!entry || !entry.kind) return;

            setLogs((prev) => {
              // Deduplicate by id if present, or by raw+at
              const entryKey = entry.id != null ? entry.id : `${entry.raw}-${entry.at}`;
              const exists = prev.some((l) => (l.id != null ? l.id === entry.id : `${l.raw}-${l.at}` === entryKey));
              if (exists) return prev;

              const next = [...prev, entry];
              return next.length > MAX_DISPLAY_LOGS ? next.slice(-MAX_DISPLAY_LOGS) : next;
            });

            setCounts((prev) => ({ ...prev, [entry.kind]: (prev[entry.kind] ?? 0) + 1 }));
          } catch {
            // ignore heartbeat or comments
          }
        };

        es.onerror = () => {
          if (!active) return;
          if (es) {
            es.close();
            es = null;
          }
          // Auto reconnect after 2s
          reconnectTimer = setTimeout(connectSSE, 2000);
        };
      } catch {
        reconnectTimer = setTimeout(connectSSE, 3000);
      }
    };

    connectSSE();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pausedRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setCounts({});
  }, []);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filters = [
    "all",
    "fire",
    "trouble",
    "supervisory",
    "fire-acknowledged",
    "acknowledged",
    "reset-in-progress",
    "reset-normal",
    "reset-complete",
    "reset-aborted",
    "cval",
    "system",
  ];
  const displayed = filter === "all"
    ? logs
    : logs.filter((l) => l.kind === filter);

  const fireCount = counts.fire ?? 0;
  const troubleCount = counts.trouble ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Panel live log</CardTitle>
            {fireCount > 0 && (
              <Badge variant="destructive" className="text-xs">{fireCount} fire</Badge>
            )}
            {troubleCount > 0 && (
              <Badge className="text-xs bg-yellow-600 hover:bg-yellow-600">{troubleCount} trouble</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPaused((p) => !p)} className="h-7 px-2 text-xs">
              {paused ? <PlayCircle className="h-3.5 w-3.5 mr-1" /> : <PauseCircle className="h-3.5 w-3.5 mr-1" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearLogs} className="h-7 px-2 text-xs text-muted-foreground">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardDescription>
          Live TCP stream from fire panel — parsed and categorised in real-time
        </CardDescription>
        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1 pt-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f === "all" ? `All (${logs.length})` : `${KIND_META[f]?.label ?? f} (${counts[f] ?? 0})`}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {displayed.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            {!connected ? "Connect to the panel to stream live logs." : "Waiting for panel data…"}
          </p>
        ) : (
          <div className="max-h-72 overflow-auto font-mono text-[11px]">
            {displayed.map((entry, i) => {
              const meta = KIND_META[entry.kind] ?? KIND_META.other;
              return (
                <div
                  key={entry.id ?? i}
                  className={`flex items-start gap-2 border-b border-border/30 px-3 py-1 leading-snug last:border-0 ${meta.bg}`}
                >
                  <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                    {formatTime(entry.at)}
                  </span>
                  <span className={`shrink-0 w-11 text-right font-bold ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="break-all text-foreground/90">
                    {formatLogRow(entry)}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function NetworkTelnetPage() {
  const { isReady, role, userRole, user } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const { showFireAlert } = useFireAlert();
  const { firePanelState, firePanelStateLoading } = useFirePanelMonitor();

  const isAdmin = useMemo(() => {
    const session = getStoredSessionUser();
    const r = String(role || userRole || user?.role || session?.role || "").toLowerCase();
    const d = String(user?.designation || session?.designation || "").toLowerCase();
    return r === "admin" || d === "admin" || d === "administrator";
  }, [role, userRole, user]);

  const handleSimulateFire = () => {
    showFireAlert({
      location: "Simulated Fire Alarm (test)",
      deviceType: "Test Device",
      deviceAddress: "SIM-TEST",
      panelTime: new Date().toLocaleString(),
      raw: "SIMULATED FIRE ALARM",
    });
  };

  const host = useFirePanelStore((s) => s.host);
  const port = useFirePanelStore((s) => s.port);
  const setHost = useFirePanelStore((s) => s.setHost);
  const setPort = useFirePanelStore((s) => s.setPort);
  const connected = useFirePanelStore((s) => s.connected);
  const connectedAt = useFirePanelStore((s) => s.connectedAt);
  const lastError = useFirePanelStore((s) => s.lastError);
  const loading = useFirePanelStore((s) => s.loading);
  const rawResponse = useFirePanelStore((s) => s.rawResponse);
  const connect = useFirePanelStore((s) => s.connect);
  const disconnect = useFirePanelStore((s) => s.disconnect);
  const sendCommand = useFirePanelStore((s) => s.sendCommand);

  const [command, setCommand] = useState("");

  const displayTotals = {
    fire: firePanelState?.totalFire ?? 0,
    trouble: firePanelState?.totalTrouble ?? 0,
    supervisory: firePanelState?.totalSupervisory ?? 0,
  };
  const lastPanelSync = firePanelState?.lastPanelSync ?? null;
  const lastPolledAt = firePanelState?.lastPolledAt ?? null;
  const lastUpdatedAt = lastPolledAt || lastPanelSync;

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
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardTopBar headerClassName="flex min-h-16 shrink-0 items-center gap-3 py-2 px-4" />

        <DashboardPageContent className="gap-4 p-4 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Network className="h-6 w-6" />
              <div>
                <h1 className="text-2xl font-semibold">Fire Panel Network</h1>
                <p className="text-sm text-muted-foreground">
                  Connect to the panel and stream live data
                </p>
              </div>
            </div>
            {isAdmin ? (
              <Button variant="destructive" size="sm" onClick={handleSimulateFire}>
                <Flame className="mr-2 h-4 w-4" />
                Simulate Fire
              </Button>
            ) : null}
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
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={handleDisconnect}
                    disabled={loading}
                  >
                    <Unplug className="mr-2 h-4 w-4" />
                    Disconnect
                  </Button>
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

              {lastUpdatedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last CVAL update:{" "}
                  {new Date(lastUpdatedAt).toLocaleString()}
                  {lastPolledAt && lastPanelSync && lastPolledAt !== lastPanelSync
                    ? ` (DB sync ${new Date(lastPanelSync).toLocaleString()})`
                    : null}
                </p>
              ) : null}

              {/* Live log console — replaces the old CVAL-only pre block */}
              <PanelLogConsole connected={isConnected} />

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {firePanelStateLoading
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
        </DashboardPageContent>
      </SidebarInset>
    </SidebarProvider>
  );
}
