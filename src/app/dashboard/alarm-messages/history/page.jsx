"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "@/components/dashboard-header";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
import { CommunityBuildingSelect } from "@/components/floor-plan/community-building-select";
import { ModeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bell, Loader2, Trash2 } from "lucide-react";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useAppData } from "@/hooks/useAppData";
import { useToast } from "@/hooks/use-toast";
import { clearBuildingAlarmHistory, fetchBuildingAlarmHistory } from "@/lib/alarmMessageHistory";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { getStoredSessionUser } from "@/lib/sessionUser";

const TAB_CONFIG = [
  {
    value: "liveFire",
    label: "Fire History",
    messageClass: "text-red-600 font-medium",
  },
  {
    value: "liveTrouble",
    label: "Trouble History",
    messageClass: "text-yellow-700 font-medium",
  },
  {
    value: "liveSupervisory",
    label: "Supervisory History",
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
          <TableHead className="w-[200px]">Time</TableHead>
          <TableHead>Message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, idx) => (
          <TableRow key={`${row.time ?? "t"}-${idx}`}>
            <TableCell className="align-top whitespace-nowrap text-muted-foreground">
              {row.formattedTime && row.formattedTime !== "—"
                ? row.formattedTime
                : "—"}
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
    role,
    userRole,
    user,
  } = useAppData({ toastOnCommunitiesError: true });
  const { toast } = useToast();

  const isAdmin = useMemo(() => {
    const session = getStoredSessionUser();
    const r = String(role || userRole || user?.role || session?.role || "").toLowerCase();
    const d = String(user?.designation || session?.designation || "").toLowerCase();
    return r === "admin" || d === "admin" || d === "administrator";
  }, [role, userRole, user]);

  const [buildings, setBuildings] = useState([]);
  const [activeTab, setActiveTab] = useState("liveFire");
  const [history, setHistory] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

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
    const buildingName = normalizeBuildingName(selectedBuilding);
    if (!buildingName) {
      setHistory(null);
      return;
    }

    if (showSpinner) setIsLoading(true);
    try {
      const data = await fetchBuildingAlarmHistory(buildingName);
      setHistory(data);
    } catch (error) {
      console.error("Error loading alarm history:", error);
      setHistory({
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

  const handleClearHistory = async () => {
    if (!selectedBuilding || isClearing) return;
    const confirmed = window.confirm(
      `Clear all alarm history for "${selectedBuilding}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setIsClearing(true);
    try {
      await clearBuildingAlarmHistory(selectedBuilding);
      await loadHistory();
      toast({ title: "History cleared", description: `Alarm history for ${selectedBuilding} was cleared.` });
    } catch (error) {
      console.error("Error clearing alarm history:", error);
      toast({
        title: "Clear failed",
        description: error?.message || "Could not clear alarm history.",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <DashboardHeader>
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
              <div className="flex items-center gap-2">
                {isAdmin && selectedBuilding ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isClearing}
                    onClick={handleClearHistory}
                  >
                    {isClearing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Clear History
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedBuilding ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Choose a community and building above to view alarm history.
                </div>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="mb-4 grid h-auto w-full grid-cols-3 gap-1 py-1">
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
                    // Render the active tab panel explicitly so content cannot
                    // collapse when TabsContent sits in an auto-height flex column.
                    TAB_CONFIG.map((tab) =>
                      activeTab === tab.value ? (
                        <div key={tab.value} className="min-h-[200px]">
                          <MessageTable
                            rows={history?.[tab.value] ?? []}
                            messageClass={tab.messageClass}
                            emptyLabel={`No ${tab.label.toLowerCase()} found.`}
                          />
                        </div>
                      ) : null,
                    )
                  )}
                </Tabs>
              )}
            </CardContent>
          </Card>
        </main>
  </DashboardHeader>
  );
}
