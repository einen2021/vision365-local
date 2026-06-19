"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import secureLocalStorage from "react-secure-storage";
import { useToast } from "@/hooks/use-toast";
import { AppSidebar } from "@/components/app-sidebar";
import { ModeToggle } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Loader2, MapPin, Hash, ImageIcon, Upload, X, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { db, storage } from "@/config/firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAppData } from "@/hooks/useAppData";
import { getStoredSessionUser } from "@/lib/sessionUser";
import FirestoreService from "@/services/firestoreService";
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"

export default function EditBuildingStatus() {
  const { communities, isLoadingCommunities, isReady, refetchCommunities } = useAppData({
    toastOnCommunitiesError: true,
  });
  const [selectedCommunity, setSelectedCommunity] = useState("");
  const [buildings, setBuildings] = useState([]);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false);
  const [buildingDetailsMap, setBuildingDetailsMap] = useState({});
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Status dialog
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");

  // Coordinates dialog
  const [isCoordDialogOpen, setIsCoordDialogOpen] = useState(false);
  const [coordBuilding, setCoordBuilding] = useState("");
  const [coordLat, setCoordLat] = useState("");
  const [coordLng, setCoordLng] = useState("");
  const [isSavingCoords, setIsSavingCoords] = useState(false);

  // Plot number dialog
  const [isPlotDialogOpen, setIsPlotDialogOpen] = useState(false);
  const [plotBuilding, setPlotBuilding] = useState("");
  const [plotNumber, setPlotNumber] = useState("");
  const [isSavingPlot, setIsSavingPlot] = useState(false);

  // Building image dialog
  const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);
  const [imageBuilding, setImageBuilding] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [currentImageUrl, setCurrentImageUrl] = useState("");
  const [isSavingImage, setIsSavingImage] = useState(false);
  const imageInputRef = useRef(null);

  // Delete building
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteBuilding, setDeleteBuilding] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const user = getStoredSessionUser();
    if (!user) {
      router.push("/");
    }
  }, [router]);

  useEffect(() => {
    if (!isReady || communities.length === 0 || selectedCommunity) return;
    if (communities.length === 1 && communities[0]?.id) {
      setSelectedCommunity(communities[0].id);
    }
  }, [isReady, communities, selectedCommunity]);

  useEffect(() => {
    if (selectedCommunity) {
      fetchBuildingsFromCommunity();
    } else {
      setBuildings([]);
      setBuildingDetailsMap({});
    }
  }, [selectedCommunity]);

  useEffect(() => {
    const fetchAllBuildingDetails = async () => {
      if (!buildings.length) {
        setBuildingDetailsMap({});
        return;
      }

      setIsLoadingDetails(true);
      try {
        const entries = await Promise.all(
          buildings.map(async (building) => {
            try {
              const snap = await getDoc(doc(db, `${building}BuildingDB`, "buildingDetails"));
              if (!snap.exists()) {
                return [
                  building,
                  { buildingStatus: "Not set", mapData: "", locationData: "", buildingImage: "" },
                ];
              }
              const d = snap.data();
              return [
                building,
                {
                  buildingStatus: d.buildingStatus || "Not set",
                  mapData: d.mapData || "",
                  locationData: d.locationData || "",
                  buildingImage: d.buildingImage || "",
                },
              ];
            } catch (error) {
              console.error(`Error fetching building details for ${building}:`, error);
              return [
                building,
                { buildingStatus: "Not set", mapData: "", locationData: "", buildingImage: "" },
              ];
            }
          })
        );

        setBuildingDetailsMap(Object.fromEntries(entries));
      } finally {
        setIsLoadingDetails(false);
      }
    };

    fetchAllBuildingDetails();
  }, [buildings]);

  const fetchBuildingsFromCommunity = async () => {
    if (!selectedCommunity) return;
    setIsLoadingBuildings(true);
    try {
      const community = communities.find((c) => c.id === selectedCommunity);
      if (community && community.buildings) {
        const formattedBuildings = community.buildings.map((building) => {
          return stripBuildingDbSuffix(building);
        });
        setBuildings(formattedBuildings);
      } else {
        setBuildings([]);
      }
    } catch (error) {
      console.error("Error fetching buildings:", error);
      toast({
        title: "Error",
        description: "Failed to load buildings",
        variant: "destructive",
      });
    } finally {
      setIsLoadingBuildings(false);
    }
  };

  // ── Status ──────────────────────────────────────────────
  const handleOpenStatusModal = async (buildingName) => {
    setSelectedBuilding(buildingName);
    setIsDialogOpen(true);
    setSelectedStatus("");
    try {
      const snap = await getDoc(doc(db, `${buildingName}BuildingDB`, "buildingDetails"));
      if (snap.exists()) {
        const data = snap.data();
        setCurrentStatus(data.buildingStatus || "");
        setSelectedStatus(data.buildingStatus || "");
      } else {
        setCurrentStatus("");
        setSelectedStatus("");
      }
    } catch (error) {
      console.error("Error fetching current status:", error);
      setCurrentStatus("");
      setSelectedStatus("");
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedBuilding || !selectedStatus) {
      toast({ title: "Error", description: "Please select a status", variant: "destructive" });
      return;
    }
    setIsUpdating(true);
    try {
      await setDoc(
        doc(db, `${selectedBuilding}BuildingDB`, "buildingDetails"),
        { buildingStatus: selectedStatus },
        { merge: true }
      );
      toast({ title: "Success", description: `Building status updated to ${selectedStatus}` });
      setBuildingDetailsMap((prev) => ({
        ...prev,
        [selectedBuilding]: {
          ...(prev[selectedBuilding] || { mapData: "", locationData: "", buildingImage: "" }),
          buildingStatus: selectedStatus,
        },
      }));
      setIsDialogOpen(false);
      setSelectedBuilding("");
      setSelectedStatus("");
      setCurrentStatus("");
    } catch (error) {
      console.error("Error updating building status:", error);
      toast({ title: "Error", description: "Failed to update building status", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  // ── Coordinates ─────────────────────────────────────────
  const handleOpenCoordModal = async (buildingName) => {
    setCoordBuilding(buildingName);
    setCoordLat("");
    setCoordLng("");
    setIsCoordDialogOpen(true);
    try {
      const snap = await getDoc(doc(db, `${buildingName}BuildingDB`, "buildingDetails"));
      if (snap.exists()) {
        const mapData = snap.data().mapData || "";
        const parts = mapData.split(",");
        if (parts.length === 2) {
          setCoordLat(parts[0].trim());
          setCoordLng(parts[1].trim());
        }
      }
    } catch (error) {
      console.error("Error fetching mapData:", error);
    }
  };

  const handleSaveCoords = async () => {
    const lat = parseFloat(coordLat);
    const lng = parseFloat(coordLng);
    if (isNaN(lat) || isNaN(lng)) {
      toast({ title: "Error", description: "Please enter valid latitude and longitude values", variant: "destructive" });
      return;
    }
    setIsSavingCoords(true);
    try {
      await setDoc(
        doc(db, `${coordBuilding}BuildingDB`, "buildingDetails"),
        { mapData: `${lat},${lng}`, updatedAt: new Date() },
        { merge: true }
      );
      toast({ title: "Success", description: "Coordinates saved successfully" });
      setBuildingDetailsMap((prev) => ({
        ...prev,
        [coordBuilding]: {
          ...(prev[coordBuilding] || { buildingStatus: "Not set", locationData: "", buildingImage: "" }),
          mapData: `${lat},${lng}`,
        },
      }));
      setIsCoordDialogOpen(false);
      setCoordBuilding("");
      setCoordLat("");
      setCoordLng("");
    } catch (error) {
      console.error("Error saving coordinates:", error);
      toast({ title: "Error", description: "Failed to save coordinates", variant: "destructive" });
    } finally {
      setIsSavingCoords(false);
    }
  };

  // ── Plot Number ──────────────────────────────────────────
  const handleOpenPlotModal = async (buildingName) => {
    setPlotBuilding(buildingName);
    setPlotNumber("");
    setIsPlotDialogOpen(true);
    try {
      const snap = await getDoc(doc(db, `${buildingName}BuildingDB`, "buildingDetails"));
      if (snap.exists()) {
        setPlotNumber(snap.data().locationData || "");
      }
    } catch (error) {
      console.error("Error fetching locationData:", error);
    }
  };

  const handleSavePlot = async () => {
    if (!plotNumber.trim()) {
      toast({ title: "Error", description: "Please enter a plot number", variant: "destructive" });
      return;
    }
    setIsSavingPlot(true);
    try {
      await setDoc(
        doc(db, `${plotBuilding}BuildingDB`, "buildingDetails"),
        { locationData: plotNumber.trim(), updatedAt: new Date() },
        { merge: true }
      );
      toast({ title: "Success", description: "Plot number saved successfully" });
      setBuildingDetailsMap((prev) => ({
        ...prev,
        [plotBuilding]: {
          ...(prev[plotBuilding] || { buildingStatus: "Not set", mapData: "", buildingImage: "" }),
          locationData: plotNumber.trim(),
        },
      }));
      setIsPlotDialogOpen(false);
      setPlotBuilding("");
      setPlotNumber("");
    } catch (error) {
      console.error("Error saving plot number:", error);
      toast({ title: "Error", description: "Failed to save plot number", variant: "destructive" });
    } finally {
      setIsSavingPlot(false);
    }
  };

  // ── Building Image ────────────────────────────────────────
  const handleOpenImageModal = async (buildingName) => {
    setImageBuilding(buildingName);
    setImageFile(null);
    setImagePreview("");
    setCurrentImageUrl("");
    setIsImageDialogOpen(true);
    try {
      const snap = await getDoc(doc(db, `${buildingName}BuildingDB`, "buildingDetails"));
      if (snap.exists()) {
        setCurrentImageUrl(snap.data().buildingImage || "");
      }
    } catch (error) {
      console.error("Error fetching buildingImage:", error);
    }
  };

  const handleImageFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please select a valid image file", variant: "destructive" });
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSaveImage = async () => {
    if (!imageFile) {
      toast({ title: "Error", description: "Please select an image to upload", variant: "destructive" });
      return;
    }
    setIsSavingImage(true);
    try {
      const ext = imageFile.name.split(".").pop();
      const storageRef = ref(storage, `buildings/${imageBuilding}/buildingImage.${ext}`);
      await uploadBytes(storageRef, imageFile);
      const downloadUrl = await getDownloadURL(storageRef);
      await setDoc(
        doc(db, `${imageBuilding}BuildingDB`, "buildingDetails"),
        { buildingImage: downloadUrl, updatedAt: new Date() },
        { merge: true }
      );
      toast({ title: "Success", description: "Building image uploaded successfully" });
      setBuildingDetailsMap((prev) => ({
        ...prev,
        [imageBuilding]: {
          ...(prev[imageBuilding] || { buildingStatus: "Not set", mapData: "", locationData: "" }),
          buildingImage: downloadUrl,
        },
      }));
      setIsImageDialogOpen(false);
      setImageBuilding("");
      setImageFile(null);
      setImagePreview("");
      setCurrentImageUrl("");
    } catch (error) {
      console.error("Error uploading building image:", error);
      toast({ title: "Error", description: "Failed to upload building image", variant: "destructive" });
    } finally {
      setIsSavingImage(false);
    }
  };

  const closeImageDialog = () => {
    setIsImageDialogOpen(false);
    setImageBuilding("");
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview("");
    setCurrentImageUrl("");
  };

  const stripBuildingDbSuffix = (name) => {
    if (typeof name !== "string") return String(name);
    return name.endsWith("BuildingDB") ? name.replace(/BuildingDB$/, "") : name;
  };

  const goToEditBuildingDetails = (buildingName) => {
    if (!buildingName) return;
    router.push(
      `/dashboard/buildings/edit_status/${encodeURIComponent(buildingName)}`,
    );
  };

  const handleOpenDeleteModal = (buildingName) => {
    setDeleteBuilding(buildingName);
    setDeleteConfirmText("");
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteBuilding = async () => {
    if (!deleteBuilding) return;
    if (deleteConfirmText.trim() !== deleteBuilding) {
      toast({
        title: "Confirmation mismatch",
        description: `Type the exact building name "${deleteBuilding}" to confirm deletion.`,
        variant: "destructive",
      });
      return;
    }
    setIsDeleting(true);
    try {
      const result = await FirestoreService.deleteBuildingCompletely(deleteBuilding);
      if (!result.success) {
        toast({
          title: "Delete failed",
          description: result.message || "Could not delete building.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Building deleted",
        description: result.message,
      });
      if (result.warnings?.length) {
        toast({
          title: "Partial warnings",
          description: result.warnings.join(" "),
          variant: "destructive",
        });
      }
      refetchCommunities();
      setBuildings((prev) => prev.filter((b) => b !== deleteBuilding));
      setBuildingDetailsMap((prev) => {
        const next = { ...prev };
        delete next[deleteBuilding];
        return next;
      });
      setIsDeleteDialogOpen(false);
      setDeleteBuilding("");
      setDeleteConfirmText("");
    } catch (error) {
      console.error("Delete building:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to delete building.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
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
                <BreadcrumbLink href="/dashboard/buildings">Buildings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Edit Building</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <PageHelpBanner />
          <Card className="w-full p-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Edit Building<FaqHelpButton articleId="page-edit-building-status" /></CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="community">Select Community</Label>
                <Select
                  value={selectedCommunity}
                  onValueChange={setSelectedCommunity}
                  disabled={isLoadingCommunities}
                >
                  <SelectTrigger id="community">
                    <SelectValue placeholder="Select a community" />
                  </SelectTrigger>
                  <SelectContent>
                    {communities.map((community) => (
                      <SelectItem key={community.id} value={community.id}>
                        {community.communityName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCommunity && (
                <div className="space-y-2">
                  <Label>Buildings</Label>
                  {isLoadingBuildings ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : buildings.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center">
                      No buildings available in this community.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Building Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Plot Number</TableHead>
                          <TableHead>Map Coordinates</TableHead>
                          <TableHead>Image</TableHead>
                          <TableHead className="w-[50px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {buildings.map((building, index) => (
                          <BuildingRow
                            key={index}
                            building={building}
                            details={buildingDetailsMap[building]}
                            isLoading={isLoadingDetails}
                            onUpdateStatus={handleOpenStatusModal}
                            onEditCoords={handleOpenCoordModal}
                            onEditPlot={handleOpenPlotModal}
                            onEditImage={handleOpenImageModal}
                            onDeleteBuilding={handleOpenDeleteModal}
                            onEditDetails={goToEditBuildingDetails}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Update Status Dialog ── */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Building Status</DialogTitle>
              <DialogDescription>
                Update the status for {selectedBuilding}
                {currentStatus && (
                  <span className="block mt-1 text-xs">
                    Current status: <span className="font-semibold">{currentStatus}</span>
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="status">Select Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="construction">Construction</SelectItem>
                    <SelectItem value="handover">Handover</SelectItem>
                    <SelectItem value="operation">Operation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedBuilding("");
                  setSelectedStatus("");
                  setCurrentStatus("");
                }}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button onClick={handleUpdateStatus} disabled={isUpdating || !selectedStatus}>
                {isUpdating ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                ) : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Edit Coordinates Dialog ── */}
        <Dialog open={isCoordDialogOpen} onOpenChange={setIsCoordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Edit Map Coordinates
              </DialogTitle>
              <DialogDescription>
                Set the map coordinates for <span className="font-semibold">{coordBuilding}</span>.
                Saved to the <code className="bg-muted px-1 rounded text-xs">mapData</code> field and displayed on the Smart City map.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="coord-lat">Latitude</Label>
                  <Input
                    id="coord-lat"
                    type="number"
                    step="any"
                    placeholder="e.g. 25.2048"
                    value={coordLat}
                    onChange={(e) => setCoordLat(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="coord-lng">Longitude</Label>
                  <Input
                    id="coord-lng"
                    type="number"
                    step="any"
                    placeholder="e.g. 55.2708"
                    value={coordLng}
                    onChange={(e) => setCoordLng(e.target.value)}
                  />
                </div>
              </div>
              {coordLat && coordLng && !isNaN(parseFloat(coordLat)) && !isNaN(parseFloat(coordLng)) && (
                <p className="text-xs text-muted-foreground">
                  Preview: <code className="bg-muted px-1 rounded">{parseFloat(coordLat)},{parseFloat(coordLng)}</code>
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsCoordDialogOpen(false);
                  setCoordBuilding("");
                  setCoordLat("");
                  setCoordLng("");
                }}
                disabled={isSavingCoords}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveCoords} disabled={isSavingCoords || !coordLat || !coordLng}>
                {isSavingCoords ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                ) : "Save Coordinates"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Edit Plot Number Dialog ── */}
        <Dialog open={isPlotDialogOpen} onOpenChange={setIsPlotDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Edit Plot Number
              </DialogTitle>
              <DialogDescription>
                Set the plot number for <span className="font-semibold">{plotBuilding}</span>.
                Saved to the <code className="bg-muted px-1 rounded text-xs">locationData</code> field in <code className="bg-muted px-1 rounded text-xs">buildingDetails</code>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="plot-number">Plot Number</Label>
                <Input
                  id="plot-number"
                  placeholder="e.g. P-1042"
                  value={plotNumber}
                  onChange={(e) => setPlotNumber(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsPlotDialogOpen(false);
                  setPlotBuilding("");
                  setPlotNumber("");
                }}
                disabled={isSavingPlot}
              >
                Cancel
              </Button>
              <Button onClick={handleSavePlot} disabled={isSavingPlot || !plotNumber.trim()}>
                {isSavingPlot ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                ) : "Save Plot Number"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Upload Building Image Dialog ── */}
        <Dialog open={isImageDialogOpen} onOpenChange={(open) => { if (!open) closeImageDialog(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Upload Building Image
              </DialogTitle>
              <DialogDescription>
                Upload an image for <span className="font-semibold">{imageBuilding}</span>.
                The download URL is saved to the <code className="bg-muted px-1 rounded text-xs">buildingImage</code> field in <code className="bg-muted px-1 rounded text-xs">buildingDetails</code>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Current image */}
              {currentImageUrl && !imagePreview && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Current Image</Label>
                  <div className="relative w-full h-40 rounded-lg overflow-hidden border bg-muted/20">
                    <img
                      src={currentImageUrl}
                      alt="Current building"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* New image preview */}
              {imagePreview && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">New Image Preview</Label>
                  <div className="relative w-full h-40 rounded-lg overflow-hidden border bg-muted/20">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(imagePreview);
                        setImageFile(null);
                        setImagePreview("");
                      }}
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* File picker */}
              <div className="space-y-2">
                <Label htmlFor="building-image">
                  {currentImageUrl ? "Replace Image" : "Select Image"}
                </Label>
                <div
                  className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {imageFile ? imageFile.name : "Click to select an image"}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">PNG, JPG, WEBP supported</p>
                </div>
                <input
                  ref={imageInputRef}
                  id="building-image"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageFileChange}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeImageDialog} disabled={isSavingImage}>
                Cancel
              </Button>
              <Button onClick={handleSaveImage} disabled={isSavingImage || !imageFile}>
                {isSavingImage ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</>
                ) : "Upload Image"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete building (irreversible) ── */}
        <Dialog
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteDialogOpen(open);
            if (!open) {
              setDeleteBuilding("");
              setDeleteConfirmText("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Delete building
              </DialogTitle>
              <DialogDescription>
                This permanently removes <span className="font-semibold">{deleteBuilding}</span>, unassigns it
                from all users, removes it from the community, and deletes related maps, assets, and files. This
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono font-semibold">{deleteBuilding}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteBuilding}
                autoComplete="off"
                disabled={isDeleting}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteBuilding}
                disabled={isDeleting || deleteConfirmText.trim() !== deleteBuilding}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  "Delete permanently"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  );
}

// ── Building row ─────────────────────────────────────────────────────────────
function BuildingRow({
  building,
  details,
  isLoading,
  onUpdateStatus,
  onEditCoords,
  onEditPlot,
  onEditImage,
  onDeleteBuilding,
  onEditDetails,
}) {
  const resolvedDetails = details || {
    buildingStatus: "Not set",
    mapData: "",
    locationData: "",
    buildingImage: "",
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{building}</TableCell>

      {/* Status */}
      <TableCell>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <span className="capitalize">{resolvedDetails.buildingStatus}</span>
        )}
      </TableCell>

      {/* Plot number */}
      <TableCell>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : resolvedDetails.locationData ? (
          <span className="flex items-center gap-1 text-sm">
            <Hash className="h-3 w-3 text-primary shrink-0" />
            <span className="text-xs">{resolvedDetails.locationData}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">Not set</span>
        )}
      </TableCell>

      {/* Map coordinates */}
      <TableCell>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : resolvedDetails.mapData ? (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3 w-3 text-primary shrink-0" />
            <code className="text-xs">{resolvedDetails.mapData}</code>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">Not set</span>
        )}
      </TableCell>

      {/* Building image */}
      <TableCell>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : resolvedDetails.buildingImage ? (
          <img
            src={resolvedDetails.buildingImage}
            alt={building}
            className="h-8 w-12 object-cover rounded border"
          />
        ) : (
          <span className="text-xs text-muted-foreground italic">No image</span>
        )}
      </TableCell>

      {/* Actions */}
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onEditDetails(building)}
          >
            Edit
          </Button>
          <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onEditDetails(building);
              }}
            >
              Edit Full Details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onUpdateStatus(building);
              }}
            >
              Update buildingStatus
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onEditCoords(building);
              }}
            >
              Edit Coordinates
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onEditPlot(building);
              }}
            >
              Edit Plot Number
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onEditImage(building);
              }}
            >
              Upload Building Image
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                onDeleteBuilding(building);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete building
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}
