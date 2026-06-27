"use client";
import { useState, useEffect } from "react";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import { AppSidebar } from "@/components/app-sidebar";
import { ModeToggle } from "@/components/theme-toggle";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import endpoints from "@/config/api";
import FirestoreService from "@/services/firestoreService";
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"

export default function AssignBuildings() {
  const [userEmail, setUserEmail] = useState("");
  const [users, setUsers] = useState([]);
  const [fetchingUsers, setFetchingUsers] = useState(false);
  const [buildings, setBuildings] = useState([]);
  const [originalBuildings, setOriginalBuildings] = useState([]); // Store original names with BuildingDB suffix
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [assignedBuildings, setAssignedBuildings] = useState([]);
  const [selectedUnassignBuilding, setSelectedUnassignBuilding] = useState("");
  const [fetchingAssigned, setFetchingAssigned] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [unassignLoading, setUnassignLoading] = useState(false);
  const [fetchingBuildings, setFetchingBuildings] = useState(false);
  const { toast } = useToast();
  const { userEmail: sessionEmail, isReady, isAuthenticated } = usePageAuth({
    redirectIfLoggedOut: true,
  });

  useEffect(() => {
    if (!isReady || !isAuthenticated || !sessionEmail) return;
    fetchBuildings(sessionEmail);
    fetchUsersList();
  }, [isReady, isAuthenticated, sessionEmail]);

  useEffect(() => {
    if (!userEmail) {
      setAssignedBuildings([]);
      setSelectedUnassignBuilding("");
      return;
    }
    let cancelled = false;
    setFetchingAssigned(true);
    FirestoreService.getUserAssignedBuildingShortNames(userEmail)
      .then((names) => {
        if (!cancelled) setAssignedBuildings(names);
      })
      .catch((err) => {
        console.error("Error loading assigned buildings:", err);
        if (!cancelled) setAssignedBuildings([]);
      })
      .finally(() => {
        if (!cancelled) setFetchingAssigned(false);
      });
    setSelectedUnassignBuilding("");
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const fetchUsersList = async () => {
    setFetchingUsers(true);
    try {
      const response = await fetch(endpoints.getusers, { method: "GET" });
      const data = await response.json();
      if (response.ok && data.status && Array.isArray(data.users)) {
        const list = data.users
          .filter((u) => u.email && String(u.email).trim())
          .map((u) => ({
            id: u.id,
            email: String(u.email).trim(),
            role: u.role,
          }))
          .sort((a, b) => a.email.localeCompare(b.email, undefined, { sensitivity: "base" }));
        setUsers(list);
      } else {
        toast({
          title: "Error",
          description: data.message || "Failed to load users.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching users:", error);
      toast({
        title: "Error",
        description: "Network error while loading users.",
        variant: "destructive",
      });
    } finally {
      setFetchingUsers(false);
    }
  };

  const fetchBuildings = async (email) => {
    setFetchingBuildings(true);
    try {
      const response = await fetch(endpoints.allbuildings, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (data.status) {
        // Store original building names (with BuildingDB suffix if present)
        setOriginalBuildings(data.buildings);
        // Strip "BuildingDB" suffix for display in dropdown
        const formattedBuildings = data.buildings.map((building) => {
          if (typeof building === 'string' && building.endsWith('BuildingDB')) {
            return building.replace('BuildingDB', '');
          }
          return building;
        });
        setBuildings(formattedBuildings);
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      console.error("Error fetching buildings:", error);
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally {
      setFetchingBuildings(false);
    }
  };

  const handleAssignBuilding = async () => {
    const email = userEmail.trim();
    if (!email || !selectedBuilding) {
      toast({ title: "Error", description: "All fields are required.", variant: "destructive" });
      return;
    }

    setAssignLoading(true);

    try {
      // Prefer Firestore: updates UserDB and MailDB, merges buildings, uses short names (matches {name}BuildingDB).
      // Backend POST /building/assign/v2 only updates MailDB and replaces buildings — often breaks users who exist only in UserDB.
      const buildingIndex = buildings.findIndex((b) => b === selectedBuilding);
      const rawName =
        buildingIndex !== -1 && originalBuildings[buildingIndex]
          ? originalBuildings[buildingIndex]
          : selectedBuilding;

      const result = await FirestoreService.assignBuildingsToUserByEmail(email, [
        rawName,
      ]);

      if (result.success) {
        toast({ title: "Success", description: result.message });
        setSelectedBuilding("");
        const refreshed =
          await FirestoreService.getUserAssignedBuildingShortNames(email);
        setAssignedBuildings(refreshed);
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error assigning building:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to assign building.",
        variant: "destructive",
      });
    } finally {
      setAssignLoading(false);
    }
  };

  const handleUnassignBuilding = async () => {
    const email = userEmail.trim();
    if (!email || !selectedUnassignBuilding) {
      toast({
        title: "Error",
        description: "Select a user and an assigned building.",
        variant: "destructive",
      });
      return;
    }

    setUnassignLoading(true);
    try {
      const result = await FirestoreService.unassignBuildingsFromUserByEmail(
        email,
        [selectedUnassignBuilding],
      );
      if (result.success) {
        toast({ title: "Success", description: result.message });
        setSelectedUnassignBuilding("");
        const refreshed =
          await FirestoreService.getUserAssignedBuildingShortNames(email);
        setAssignedBuildings(refreshed);
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error unassigning building:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to unassign building.",
        variant: "destructive",
      });
    } finally {
      setUnassignLoading(false);
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <ModeToggle />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Buildings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Assign Buildings</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <FirePanelStatusBadges />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <PageHelpBanner />
          <Card className="w-full p-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Building access<FaqHelpButton articleId="page-assign-buildings" /></CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="userEmail">User</Label>
                <Select
                  value={userEmail || undefined}
                  onValueChange={setUserEmail}
                  disabled={fetchingUsers || users.length === 0}
                >
                  <SelectTrigger id="userEmail" className="mt-1.5 w-full">
                    <SelectValue
                      placeholder={
                        fetchingUsers
                          ? "Loading users..."
                          : users.length === 0
                            ? "No users found"
                            : "Select a user"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id || u.email} value={u.email}>
                        <span className="truncate">
                          {u.email}
                          {u.role ? (
                            <span className="text-muted-foreground ml-2 text-xs">
                              ({u.role})
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium">Assign</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  Grant access to a building from the full list.
                </p>
                <Select
                  value={selectedBuilding || undefined}
                  onValueChange={setSelectedBuilding}
                  disabled={fetchingBuildings || buildings.length === 0 || !userEmail}
                >
                  <SelectTrigger id="building" className="mt-1.5 w-full">
                    <SelectValue placeholder={fetchingBuildings ? "Loading buildings..." : buildings.length === 0 ? "No buildings available" : "Select a building to assign"} />
                  </SelectTrigger>
                  <SelectContent>
                    {buildings.length === 0 ? (
                      <SelectItem value="no-buildings" disabled>
                        {fetchingBuildings ? "Loading..." : "No buildings available"}
                      </SelectItem>
                    ) : (
                      buildings.map((building, index) => (
                        <SelectItem key={index} value={building}>
                          {building}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full mt-3"
                  onClick={handleAssignBuilding}
                  disabled={
                    assignLoading || !userEmail || !selectedBuilding
                  }
                >
                  {assignLoading ? "Assigning..." : "Assign building"}
                </Button>
              </div>

              <Separator />

              <div>
                <Label className="text-sm font-medium">Unassign</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  Remove access to a building this user already has.
                </p>
                <Select
                  value={selectedUnassignBuilding || undefined}
                  onValueChange={setSelectedUnassignBuilding}
                  disabled={
                    !userEmail ||
                    fetchingAssigned ||
                    assignedBuildings.length === 0
                  }
                >
                  <SelectTrigger id="unassign-building" className="mt-1.5 w-full">
                    <SelectValue
                      placeholder={
                        !userEmail
                          ? "Select a user first"
                          : fetchingAssigned
                            ? "Loading assignments..."
                            : assignedBuildings.length === 0
                              ? "No buildings assigned to this user"
                              : "Select a building to remove"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {assignedBuildings.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full mt-3"
                  variant="outline"
                  onClick={handleUnassignBuilding}
                  disabled={
                    unassignLoading ||
                    !userEmail ||
                    !selectedUnassignBuilding
                  }
                >
                  {unassignLoading ? "Removing..." : "Unassign building"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
