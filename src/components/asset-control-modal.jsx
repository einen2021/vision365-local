"use client"

import { useState, useEffect } from "react"
import { db } from "@/config/firebase"
import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
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
import { Loader2, Edit, MapPin, Power, PowerOff, CheckCircle, XCircle, Flame, AlertTriangle } from "lucide-react"
import {
  getFireStatusDisplay,
  normalizeSimplexStatus,
  simplexStatusToActive,
} from "@/lib/assetFireStatus"
import { resolveAssetsListDocId, resetSimplexFlag } from "@/lib/assetsListSimplexStatus"
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore"

/**
 * Helper function to map display category names to Firestore collection keys
 */
const getCategoryKey = (categoryName) => {
  if (!categoryName) return "general"
  
  const categoryMap = {
    "fire-life-safety": "fire-life-safety",
    "fire fighting": "fire-life-safety",
    "electrical": "electrical",
    "hvac": "hvac",
    "plumbing": "plumbing",
    "elv": "elv",
    "security": "security",
    "vertical-transport": "vertical-transport",
    "lighting": "lighting",
    "bms": "bms",
    "landscaping": "landscaping",
    "additional": "additional",
  }
  
  // Try exact match first, then normalize for case-insensitive search
  const normalized = categoryName.toLowerCase().trim()
  return categoryMap[normalized] || "fire-life-safety"
}

/**
 * Global Asset Control Modal Component
 * 
 * This modal allows administrators to control asset details including:
 * - Installation status
 * - Activity status (on/off)
 * - Enable/disable state
 * - Device location and address
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Controls modal visibility
 * @param {Function} props.onClose - Callback when modal closes
 * @param {Object} props.asset - The asset mapping object to control
 * @param {string} props.selectedBuilding - Current building name
 * @param {string} props.buildingStatus - Building status (construction/operational)
 * @param {string} props.userRole - Current user role (admin/viewer/etc)
 */
export function AssetControlModal({
  isOpen,
  onClose,
  asset,
  selectedBuilding,
  buildingStatus = "",
  userRole = "",
}) {
  const { toast } = useToast()
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false)
  const [deviceLocation, setDeviceLocation] = useState("")
  const [deviceAddress, setDeviceAddress] = useState("")
  const [installed, setInstalled] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [simplexStatus, setSimplexStatus] = useState({ F: 0, T: 0 })

  // Load asset data when modal opens or asset changes
  useEffect(() => {
    if (isOpen && asset && selectedBuilding) {
      loadAssetData()
    }
  }, [isOpen, asset, selectedBuilding])

  // Reset fields when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDeviceLocation("")
      setDeviceAddress("")
      setInstalled(false)
      setSelectedAsset(null)
      setSimplexStatus({ F: 0, T: 0 })
    }
  }, [isOpen])

  const loadSimplexStatus = async (assetRecord, location, address) => {
    const assetsListId = await resolveAssetsListDocId(assetRecord, address)
    if (assetsListId) {
      const listSnap = await getDoc(doc(db, "AssetsList", assetsListId))
      if (listSnap.exists()) {
        return normalizeSimplexStatus(listSnap.data()?.simplexStatus)
      }
    }

    const storeStatus = useAssetFireStatusStore
      .getState()
      .getSimplexStatus(assetRecord.buildingAssetId || assetRecord.id, address)
    if (storeStatus) return normalizeSimplexStatus(storeStatus)

    return { F: 0, T: 0 }
  }

  const loadAssetData = async () => {
    try {      // Use the building name from selectedBuilding prop
      if (!selectedBuilding) {
        console.warn("No building selected for asset control");
        return;
      }
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      
      // Build the asset document path
      // Map category display name to actual Firestore collection key
      const categoryKey = getCategoryKey(asset.categoryKey || asset.assetCategory || asset.category || "general")
      const assetId = asset.id || asset.buildingAssetId
      
      if (!assetId) {
        console.warn("Asset ID not found, cannot load asset data")
        return
      }

      const assetDocRef = doc(db, buildingNameWithSuffix, "asset", categoryKey, assetId)
      const assetDoc = await getDoc(assetDocRef)

      let assetData = {}
      if (assetDoc.exists()) {
        assetData = assetDoc.data()
      }

      const installedStatus = assetData.installed !== undefined ? assetData.installed : false

      setSelectedAsset({
        ...asset,
        buildingAssetId: assetId,
        assetCategory: categoryKey,
        activityStatus: assetData.activityStatus !== undefined ? assetData.activityStatus : asset.active || 0,
        enabled: assetData.enabled !== undefined ? assetData.enabled : true,
        deviceLocation: assetData.deviceLocation || "",
        deviceAddress: assetData.deviceAddress || "",
        installed: installedStatus,
      })
      setDeviceLocation(assetData.deviceLocation || "")
      setDeviceAddress(assetData.deviceAddress || "")
      setInstalled(installedStatus)

      const panelStatus = await loadSimplexStatus(
        { ...asset, buildingAssetId: assetId },
        assetData.deviceLocation || "",
        assetData.deviceAddress || "",
      )
      setSimplexStatus(panelStatus)
    } catch (error) {
      console.error("Error loading asset data:", error)
      toast({
        title: "Error",
        description: "Failed to load asset details",
        variant: "destructive",
      })
    }
  }

  // Update installed status
  const handleUpdateInstalled = async (installedValue) => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update installation status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus?.toLowerCase() !== "construction") {
      toast({
        title: "Feature Unavailable",
        description: "Asset controls are only available for buildings with 'Construction' status",
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
        selectedAsset.buildingAssetId
      )

      await updateDoc(assetDocRef, {
        installed: installedValue,
      })

      setSelectedAsset({ ...selectedAsset, installed: installedValue })
      setInstalled(installedValue)
      toast({
        title: "Success",
        description: `Asset ${installedValue ? "marked as installed" : "marked as not installed"} successfully`,
      })
    } catch (error) {
      console.error("Error updating installed status:", error)
      toast({
        title: "Error",
        description: "Failed to update installation status",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  // Update asset activity status (on/off)
  const handleUpdateActivityStatus = async (status) => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update asset status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus?.toLowerCase() !== "construction") {
      toast({
        title: "Feature Unavailable",
        description: "Asset controls are only available for buildings with 'Construction' status",
        variant: "destructive",
      })
      return
    }

    if (!selectedAsset.installed) {
      toast({
        title: "Action Restricted",
        description: "Asset must be installed before you can change its activity status",
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
        selectedAsset.buildingAssetId
      )

      await updateDoc(assetDocRef, {
        activityStatus: status,
      })

      setSelectedAsset({ ...selectedAsset, activityStatus: status })
      toast({
        title: "Success",
        description: `Asset ${status === 0 ? "turned off" : "turned on"} successfully`,
      })
    } catch (error) {
      console.error("Error updating activity status:", error)
      toast({
        title: "Error",
        description: "Failed to update asset status",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  // Update asset enabled status
  const handleUpdateEnabled = async (enabled) => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update asset status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus?.toLowerCase() !== "construction") {
      toast({
        title: "Feature Unavailable",
        description: "Asset controls are only available for buildings with 'Construction' status",
        variant: "destructive",
      })
      return
    }

    if (!selectedAsset.installed) {
      toast({
        title: "Action Restricted",
        description: "Asset must be installed before you can enable/disable it",
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
        selectedAsset.buildingAssetId
      )

      await updateDoc(assetDocRef, {
        enabled: enabled,
      })

      // If disabling the asset and deviceAddress exists, add it to the disabled array in actions
      if (!enabled && selectedAsset.enabled && selectedAsset.deviceAddress && selectedAsset.deviceAddress.trim() !== "") {
        try {
          const actionsDocRef = doc(db, buildingNameWithSuffix, "actions")
          await updateDoc(actionsDocRef, {
            disabled: arrayUnion(selectedAsset.deviceAddress.trim()),
          })
          console.log("Device address added to disabled array:", selectedAsset.deviceAddress)
        } catch (actionsError) {
          console.error("Error updating disabled array:", actionsError)
          // Don't fail the main operation if actions update fails
        }
      }

      setSelectedAsset({ ...selectedAsset, enabled })
      toast({
        title: "Success",
        description: `Asset ${enabled ? "enabled" : "disabled"} successfully`,
      })
    } catch (error) {
      console.error("Error updating enabled status:", error)
      toast({
        title: "Error",
        description: "Failed to update asset status",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  const handleResetSimplexFlag = async (flag) => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can reset panel alarm status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus?.toLowerCase() !== "construction") {
      toast({
        title: "Feature Unavailable",
        description: "Asset controls are only available for buildings with 'Construction' status",
        variant: "destructive",
      })
      return
    }

    setIsUpdatingAsset(true)
    try {
      const next = await resetSimplexFlag(selectedAsset, deviceAddress, flag)
      setSimplexStatus(next)
      await useAssetFireStatusStore.getState().syncFromAssetsList()
      toast({
        title: "Success",
        description: flag === "F" ? "Fire status (F) reset to 0" : "Trouble status (T) reset to 0",
      })
    } catch (error) {
      console.error(`Error resetting simplex ${flag}:`, error)
      toast({
        title: "Error",
        description: error.message || `Failed to reset ${flag === "F" ? "fire" : "trouble"} status`,
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  // Update device location and address
  const handleUpdateLocation = async () => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update device location",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus?.toLowerCase() !== "construction") {
      toast({
        title: "Feature Unavailable",
        description: "Asset controls are only available for buildings with 'Construction' status",
        variant: "destructive",
      })
      return
    }

    if (!selectedAsset.installed) {
      toast({
        title: "Action Restricted",
        description: "Asset must be installed before you can update its location",
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
        selectedAsset.buildingAssetId
      )

      await updateDoc(assetDocRef, {
        deviceLocation: deviceLocation.trim(),
        deviceAddress: deviceAddress.trim(),
      })

      setSelectedAsset({
        ...selectedAsset,
        deviceLocation: deviceLocation.trim(),
        deviceAddress: deviceAddress.trim(),
      })
      toast({
        title: "Success",
        description: "Device location and address updated successfully",
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

  const panelActive = simplexStatusToActive(simplexStatus.F, simplexStatus.T)
  const panelDisplay = getFireStatusDisplay(panelActive)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Asset Control - {selectedAsset?.assetName || asset.assetName || asset.name || "Asset"}
          </DialogTitle>
          <DialogDescription>
            {selectedAsset?.category || asset.category} at position ({asset.x}, {asset.y})
          </DialogDescription>
        </DialogHeader>

        {userRole === "admin" && buildingStatus?.toLowerCase() === "construction" ? (
          <div className="space-y-6 py-4">
            {/* Installation Status */}
            <div className="space-y-2">
              <Label className="text-base font-semibold flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Installation Status
              </Label>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <input
                  type="checkbox"
                  id="installed"
                  checked={installed}
                  onChange={(e) => handleUpdateInstalled(e.target.checked)}
                  disabled={isUpdatingAsset}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Label htmlFor="installed" className="text-sm font-medium cursor-pointer flex-1">
                  Asset is installed
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Current Status: {installed ? "Installed" : "Not Installed"}
              </p>
              {!installed && (
                <Alert className="mt-2">
                  <AlertDescription className="text-xs">
                    Other controls are disabled until the asset is marked as installed.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Panel fire / trouble status (AssetsList simplexStatus) */}
            <div className="space-y-2">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Flame className="h-4 w-4" />
                Panel Alarm Status
              </Label>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-sm">
                  F (Fire): <span className="font-mono font-semibold">{simplexStatus.F}</span>
                  {" · "}
                  T (Trouble): <span className="font-mono font-semibold">{simplexStatus.T}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Marker status:{" "}
                  <span style={{ color: panelDisplay.color }}>{panelDisplay.label}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleResetSimplexFlag("F")}
                  disabled={isUpdatingAsset || Number(simplexStatus.F) === 0}
                  className="flex-1 border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Flame className="mr-2 h-4 w-4" />
                  Reset Fire (F→0)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleResetSimplexFlag("T")}
                  disabled={isUpdatingAsset || Number(simplexStatus.T) === 0}
                  className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Reset Trouble (T→0)
                </Button>
              </div>
            </div>

            {/* Activity Status (On/Off) */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">Activity Status</Label>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleUpdateActivityStatus(1)}
                  disabled={isUpdatingAsset || selectedAsset?.activityStatus === 1 || !installed}
                  className={`flex-1 ${
                    selectedAsset?.activityStatus === 1
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  } ${!installed ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Power className="mr-2 h-4 w-4" />
                  On
                </Button>
                <Button
                  onClick={() => handleUpdateActivityStatus(0)}
                  disabled={isUpdatingAsset || selectedAsset?.activityStatus === 0 || !installed}
                  className={`flex-1 ${
                    selectedAsset?.activityStatus === 0
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  } ${!installed ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <PowerOff className="mr-2 h-4 w-4" />
                  Off
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Current Status: {selectedAsset?.activityStatus === 1 ? "On" : "Off"}
              </p>
            </div>

            {/* Enable/Disable */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">Enable/Disable Asset</Label>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleUpdateEnabled(true)}
                  disabled={isUpdatingAsset || selectedAsset?.enabled === true || !installed}
                  className={`flex-1 ${
                    selectedAsset?.enabled === true
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  } ${!installed ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Enable
                </Button>
                <Button
                  onClick={() => handleUpdateEnabled(false)}
                  disabled={isUpdatingAsset || selectedAsset?.enabled === false || !installed}
                  className={`flex-1 ${
                    selectedAsset?.enabled === false
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  } ${!installed ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Disable
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Current State: {selectedAsset?.enabled ? "Enabled" : "Disabled"}
              </p>
            </div>

            {/* Device Location and Address */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="deviceLocation" className="text-base font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Device Location
                </Label>
                <Input
                  id="deviceLocation"
                  value={deviceLocation}
                  onChange={(e) => setDeviceLocation(e.target.value)}
                  placeholder="Enter device location"
                  disabled={isUpdatingAsset || !installed}
                  className={!installed ? "opacity-50 cursor-not-allowed" : ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deviceAddress" className="text-base font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Device Address
                </Label>
                <Input
                  id="deviceAddress"
                  value={deviceAddress}
                  onChange={(e) => setDeviceAddress(e.target.value)}
                  placeholder="Enter device address"
                  disabled={isUpdatingAsset || !installed}
                  className={!installed ? "opacity-50 cursor-not-allowed" : ""}
                />
              </div>

              <Button
                onClick={handleUpdateLocation}
                disabled={isUpdatingAsset || !installed}
                className={`w-full ${!installed ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {isUpdatingAsset ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <MapPin className="mr-2 h-4 w-4" />
                    Update Location & Address
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-4">
            <Alert>
              <AlertTitle>
                {userRole !== "admin" ? "Access Restricted" : "Feature Unavailable"}
              </AlertTitle>
              <AlertDescription>
                {userRole !== "admin"
                  ? "Only administrators can control assets. Please contact an admin for assistance."
                  : `Asset controls are only available for buildings with 'Construction' status. Current building status: ${buildingStatus || "Unknown"}`}
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
