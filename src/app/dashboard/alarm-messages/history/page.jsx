"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
import { CommunityBuildingSelect } from "@/components/floor-plan/community-building-select";
import { ModeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Bell, Loader2 } from "lucide-react";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useAppData } from "@/hooks/useAppData";
import FirestoreService from "@/services/firestoreService";
import { fetchBuildingAlarmHistory } from "@/lib/alarmMessageHistory";

const TAB_CONFIG = [
  {
    value: "alarmMessages",
    label: "Alarm messages",
    messageClass: "text-foreground",
  },
  {
    value: "liveFire",
    label: "Live fire",
    messageClass: "text-red-600 font-medium",
  },
  {
    value: "liveTrouble",
    label: "Live trouble",
    messageClass: "text-yellow-700 font-medium",
  },
  {
    value: "liveSupervisory",
    label: "Live supervisory",
    messageClass: "text-blue-600 font-medium",
  },
];

function MessageTable({ rows, messageClass, emptyLabel }) {
  if (!rows?.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">Time</TableHead>
          <TableHead>Message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, idx) => (
          <TableRow key={`${row.time}-${idx}`}>
            <TableCell className="align-top whitespace-nowrap">
              {row.formattedTime}
            </TableCell>
            <TableCell className={`break-words ${messageClass}`}>
              {row.message || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AlarmMessagesHistoryPage() {
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const {
    communities,
    isLoadingCommunities,
    selectedBuilding,
    setSelectedBuilding,
    selectedCommunity,
    setSelectedCommunity,
  } = useAppData({ toastOnCommunitiesError: true });

  const [buildings, setBuildings] = useState([]);
  const [activeTab, setActiveTab] = useState("alarmMessages");
  const [history, setHistory] = useState(null);
  const [panelStatus, setPanelStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Keep local community/building lists in sync with AppContext selection
  useEffect(() => {
    if (!selectedCommunity && communities.length > 0) {
      setSelectedCommunity(communities[0].id);
    }
  }, [communities, selectedCommunity, setSelectedCommunity]);

  useEffect(() => {
    if (!selectedCommunity) {
      setBuildings([]);
      return;
    }
    const community = communities.find((c) => c.id === selectedCommunity);
    const nextBuildings = community?.buildings || [];
    setBuildings(nextBuildings);

    if (selectedBuilding && !nextBuildings.includes(selectedBuilding)) {
      setSelectedBuilding("");
    }
  }, [selectedCommunity, communities, selectedBuilding, setSelectedBuilding]);

  const loadHistory = useCallback(async (options = {}) => {
    const { showSpinner = false } = options;
    if (!selectedBuilding) {
      setHistory(null);
      setPanelStatus(null);
      return;
    }

    if (showSpinner) setIsLoading(true);
    try {
      const [data, details] = await Promise.all([
        fetchBuildingAlarmHistory(selectedBuilding),
        FirestoreService.getBuildingAlarmDetails(selectedBuilding),
      ]);
      setHistory(data);
      setPanelStatus(details?.panelStatus === true);
    } catch (error) {
      console.error("Error loading alarm history:", error);
      setHistory({
        alarmMessages: [],
        liveFire: [],
        liveTrouble: [],
        liveSupervisory: [],
      });
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }, [selectedBuilding]);

  useEffect(() => {
    loadHistory({ showSpinner: true });
    const interval = setInterval(() => loadHistory(), 2000);
    return () => clearInterval(interval);
  }, [loadHistory]);

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
          <div className="ml-auto flex items-center gap-2">
            <FirePanelStatusBadges />
            <ModeToggle />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <div className="flex items-center gap-2">
            <Bell className="h-6 w-6" />
            <div>
              <h1 className="text-2xl font-semibold">Alarm Messages History</h1>
              <p className="text-sm text-muted-foreground">
                Archived and live alarm feeds for the selected building
              </p>
            </div>
          </div>

          <CommunityBuildingSelect
            communities={communities}
            isLoadingCommunities={isLoadingCommunities}
            selectedCommunity={selectedCommunity || ""}
            onCommunityChange={setSelectedCommunity}
            buildings={buildings}
            selectedBuilding={selectedBuilding || ""}
            onBuildingChange={setSelectedBuilding}
          />

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>
                  {selectedBuilding
                    ? `${selectedBuilding} alarm history`
                    : "Select a building"}
                </CardTitle>
                <CardDescription>
                  Messages refresh every 2 seconds while this page is open.
                </CardDescription>
              </div>
              {selectedBuilding ? (
                <Badge
                  variant="outline"
                  className={
                    panelStatus
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-600"
                  }
                >
                  Panel {panelStatus ? "ON" : "OFF"}
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent>
              {!selectedBuilding ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Choose a community and building above to view alarm history.
                </div>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-1 py-1 sm:grid-cols-4">
                    {TAB_CONFIG.map((tab) => (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="text-xs px-2"
                      >
                        {tab.label}
                        {history ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            ({history[tab.value]?.length ?? 0})
                          </span>
                        ) : null}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {isLoading && !history ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      Loading alarm history…
                    </div>
                  ) : (
                    TAB_CONFIG.map((tab) => (
                      <TabsContent key={tab.value} value={tab.value}>
                        <MessageTable
                          rows={history?.[tab.value] ?? []}
                          messageClass={tab.messageClass}
                          emptyLabel={`No ${tab.label.toLowerCase()} found.`}
                        />
                      </TabsContent>
                    ))
                  )}
                </Tabs>
              )}
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
