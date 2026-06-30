"use client"

import { useState, useEffect } from "react"
import { db } from "@/config/firebase"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useFirePanelMonitor } from "@/contexts/AppContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Loader2, Edit, MapPin, CheckCircle, XCircle } from "lucide-react"
import { resolveAssetsListDocId } from "@/lib/assetsListSimplexStatus"

const getCategoryKey = (categoryName) => {
  if (!categoryName) return "general"

  const categoryMap = {
    "fire-life-safety": "fire-life-safety",
    "fire fighting": "fire-life-safety",
    electrical: "electrical",
    hvac: "hvac",
    plumbing: "plumbing",
    elv: "elv",
    security: "security",
    "vertical-transport": "vertical-transport",
    lighting: "lighting",
    bms: "bms",
    landscaping: "landscaping",
    additional: "additional",
  }

  const normalized = categoryName.toLowerCase().trim()
  return categoryMap[normalized] || "fire-life-safety"
}

export function AssetControlModal({
  isOpen,
  onClose,
  asset,
  selectedBuilding,
  userRole = "",
}) {
  const { toast } = useToast()
  const { enableDevice, disableDevice } = useFirePanelMonitor()
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false)
  const [deviceLocation, setDeviceLocation] = useState("")
  const [deviceAddress, setDeviceAddress] = useState("")
  const [deviceDescription, setDeviceDescription] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [selectedAsset, setSelectedAsset] = useState(null)

  useEffect(() => {
    if (isOpen && asset && selectedBuilding) {
      loadAssetData()
    }
  }, [isOpen, asset, selectedBuilding])

  useEffect(() => {
    if (!isOpen) {
      setDeviceLocation("")
      setDeviceAddress("")
      setDeviceDescription("")
      setEnabled(true)
      setSelectedAsset(null)
    }
  }, [isOpen])

  const loadAssetData = async () => {
    try {
      if (!selectedBuilding) {
        console.warn("No building selected for asset control")
        return
      }

      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const categoryKey = getCategoryKey(
        asset.categoryKey || asset.assetCategory || asset.category || "general",
      )
      // Prefer buildingAssetId — mapping `id` is the floor-plan doc id, not the asset doc id.
      const assetId = asset.buildingAssetId || asset.id

      if (!assetId) {
        console.warn("Asset ID not found, cannot load asset data")
        return
      }

      const assetDocRef = doc(db, buildingNameWithSuffix, "asset", categoryKey, assetId)
      const assetDoc = await getDoc(assetDocRef)
      const assetData = assetDoc.exists() ? assetDoc.data() : {}

      const address = assetData.deviceAddress || asset.deviceAddress || ""
      let description =
        assetData.deviceDescription ||
        assetData.description ||
        asset.deviceDescription ||
        asset.description ||
        ""

      let location = String(assetData.deviceLocation || "").trim()

      const assetsListId = await resolveAssetsListDocId(
        { ...asset, buildingAssetId: assetId },
        address,
      )
      if (assetsListId) {
        const listSnap = await getDoc(doc(db, "AssetsList", assetsListId))
        if (listSnap.exists()) {
          const listData = listSnap.data()
          if (!description) {
            description = listData.deviceDescription || listData.description || ""
          }
          // Only use explicit deviceLocation from AssetsList — never description.
          if (!location) {
            location = String(listData.deviceLocation || "").trim()
          }
        }
      }

      const enabledStatus = assetData.enabled !== undefined ? assetData.enabled : true

      const descTrimmed = description.trim()
      if (location && descTrimmed && location.toLowerCase() === descTrimmed.toLowerCase()) {
        location = ""
      }

      setSelectedAsset({
        ...asset,
        buildingAssetId: assetId,
        assetCategory: categoryKey,
      })
      setDeviceLocation(location)
      setDeviceAddress(address)
      setDeviceDescription(description)
      setEnabled(enabledStatus)
    } catch (error) {
      console.error("Error loading asset data:", error)
      toast({
        title: "Error",
        description: "Failed to load asset details",
        variant: "destructive",
      })
    }
  }

  const updateAssetEnabled = async (nextEnabled) => {
    const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
    const assetDocRef = doc(
      db,
      buildingNameWithSuffix,
      "asset",
      selectedAsset.assetCategory,
      selectedAsset.buildingAssetId,
    )

    await updateDoc(assetDocRef, {
      enabled: nextEnabled,
      updatedAt: new Date().toISOString(),
    })
  }

  const handleEnable = async () => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can enable devices",
        variant: "destructive",
      })
      return
    }

    const address = deviceAddress.trim()
    if (!address) {
      toast({
        title: "Missing Address",
        description: "This asset has no device address to enable",
        variant: "destructive",
      })
      return
    }

    setIsUpdatingAsset(true)
    try {
      await enableDevice(address)
      await updateAssetEnabled(true)
      setEnabled(true)
      toast({
        title: "Success",
        description: "Device enabled successfully",
      })
    } catch (error) {
      console.error("Error enabling device:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to enable device",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  const handleDisable = async () => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can disable devices",
        variant: "destructive",
      })
      return
    }

    const address = deviceAddress.trim()
    if (!address) {
      toast({
        title: "Missing Address",
        description: "This asset has no device address to disable",
        variant: "destructive",
      })
      return
    }

    setIsUpdatingAsset(true)
    try {
      await disableDevice(address)
      await updateAssetEnabled(false)
      setEnabled(false)
      toast({
        title: "Success",
        description: "Device disabled successfully",
      })
    } catch (error) {
      console.error("Error disabling device:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to disable device",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  const handleUpdateLocation = async () => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update device location",
        variant: "destructive",
      })
      return
    }

    setIsUpdatingAsset(true)
    try {
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const assetDocRef = doc(
        db,
        buildingNameWithSuffix,
        "asset",
        selectedAsset.assetCategory,
        selectedAsset.buildingAssetId,
      )

      await updateDoc(assetDocRef, {
        deviceLocation: deviceLocation.trim(),
        updatedAt: new Date().toISOString(),
      })

      toast({
        title: "Success",
        description: "Device location updated successfully",
      })
    } catch (error) {
      console.error("Error updating device location:", error)
      toast({
        title: "Error",
        description: "Failed to update device location",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  if (!asset) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[min(90vh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[500px]">
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 shrink-0" />
            <span className="truncate">
              Asset Control - {selectedAsset?.assetName || asset.assetName || asset.name || "Asset"}
            </span>
          </DialogTitle>
          <DialogDescription>
            {selectedAsset?.category || asset.category} at position ({asset.x}, {asset.y})
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {userRole === "admin" ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Device Address</Label>
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-mono">
                  {deviceAddress || "Not set"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Device Description</Label>
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  {deviceDescription || "No description available"}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Enable / Disable</Label>
                <div className="flex gap-2">
                  <Button
                    onClick={handleEnable}
                    disabled={isUpdatingAsset || enabled || !deviceAddress.trim()}
                    className={`flex-1 ${
                      enabled
                        ? "bg-green-600 hover:bg-green-700"
                        : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Enable
                  </Button>
                  <Button
                    onClick={handleDisable}
                    disabled={isUpdatingAsset || !enabled || !deviceAddress.trim()}
                    className={`flex-1 ${
                      !enabled
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Disable
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Current state: {enabled ? "Enabled" : "Disabled"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deviceLocation" className="text-sm font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Device Location
                </Label>
                <Input
                  id="deviceLocation"
                  value={deviceLocation}
                  onChange={(e) => setDeviceLocation(e.target.value)}
                  placeholder="Enter device location"
                  disabled={isUpdatingAsset}
                />
                <Button
                  onClick={handleUpdateLocation}
                  disabled={isUpdatingAsset}
                  className="w-full"
                >
                  {isUpdatingAsset ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <MapPin className="mr-2 h-4 w-4" />
                      Update Location
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Alert>
              <AlertTitle>Access Restricted</AlertTitle>
              <AlertDescription>
                Only administrators can control assets. Please contact an admin for assistance.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
