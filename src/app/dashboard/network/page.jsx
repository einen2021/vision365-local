"use client";

import { useState } from "react";
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
import { useFirePanelStore, POLL_INTERVAL_MS } from "@/stores/firePanelStore";

const COMMAND_PLACEHOLDER = "cshow a0 cval";

function AlarmCard({ title, icon: Icon, total, register, tone }) {
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
  const monitoring = useFirePanelStore((s) => s.monitoring);
  const panelData = useFirePanelStore((s) => s.panelData);
  const readLogs = useFirePanelStore((s) => s.readLogs);
  const lastError = useFirePanelStore((s) => s.lastError);
  const loading = useFirePanelStore((s) => s.loading);
  const rawResponse = useFirePanelStore((s) => s.rawResponse);
  const connect = useFirePanelStore((s) => s.connect);
  const disconnect = useFirePanelStore((s) => s.disconnect);
  const startMonitoring = useFirePanelStore((s) => s.startMonitoring);
  const stopMonitoring = useFirePanelStore((s) => s.stopMonitoring);
  const sendCommand = useFirePanelStore((s) => s.sendCommand);

  const [command, setCommand] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const handleConnect = async () => {
    const result = await connect();
    if (result.ok) {
      toast({
        title: "Connected",
        description: `Connected to ${host.trim()}:${port}`,
      });
    }
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
      toast({ title: "Monitoring stopped", description: "Panel data reads paused" });
      return;
    }

    const result = startMonitoring();
    if (result.ok) {
      toast({
        title: "Monitoring started",
        description: `Reading panel data every ${POLL_INTERVAL_MS / 1000}s (runs globally)`,
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
                Connect to the panel, then click Monitor Data to read alarms globally
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

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Read logs</CardTitle>
                  <CardDescription>
                    Telnet commands and panelData read steps
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {readLogs.length > 0 ? (
                    <pre className="max-h-56 overflow-auto rounded border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
                      {readLogs.join("\n")}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Connect and click Monitor Data to see read logs here.
                    </p>
                  )}
                </CardContent>
              </Card>

              {panelData?.polledAt ? (
                <p className="text-xs text-muted-foreground">
                  Last poll: {panelData.host}:{panelData.port} ·{" "}
                  {new Date(panelData.polledAt).toLocaleString()}
                </p>
              ) : null}

              {panelData?.alarms ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <AlarmCard
                    title="Fire"
                    icon={Flame}
                    register="a0"
                    total={panelData.alarms.fire.total}
                    tone="fire"
                  />
                  <AlarmCard
                    title="Trouble"
                    icon={AlertTriangle}
                    register="a1"
                    total={panelData.alarms.trouble.total}
                    tone="trouble"
                  />
                  <AlarmCard
                    title="Supervisory"
                    icon={Eye}
                    register="a2"
                    total={panelData.alarms.supervisory.total}
                    tone="supervisory"
                  />
                </div>
              ) : (
                <Card>
                  <CardContent className="flex min-h-[280px] items-center justify-center p-6 text-sm text-muted-foreground">
                    {monitoring
                      ? "Waiting for panel data..."
                      : isConnected
                        ? "Connected — click Monitor Data to start reading"
                        : "Connect to the panel to begin"}
                  </CardContent>
                </Card>
              )}

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

              {panelData ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  {showRaw ? "Hide" : "Show"} raw JSON
                </Button>
              ) : null}

              {showRaw && panelData ? (
                <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs font-mono">
                  {JSON.stringify(panelData, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
