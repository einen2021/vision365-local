"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { db } from "@/config/firebase"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useFirePanelMonitor } from "@/contexts/AppContext"
import { useFirePanelStore } from "@/stores/firePanelStore"
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
import { Loader2, Edit, MapPin, CheckCircle, XCircle, RefreshCcw } from "lucide-react"
import { resolveAssetsListDocId } from "@/lib/assetsListSimplexStatus"
import { useDeviceEnabledStore } from "@/stores/deviceEnabledStore"
import {
  getPrimaryStatusTone,
  parsePanelShowResponse,
} from "@/lib/parsePanelShowResponse"
import { withMonitorPaused, pauseMonitorLoop, resumeMonitorLoop, waitForMonitorYield } from "@/lib/firePanelMonitorSession"
import { cn } from "@/lib/utils"

/** Small delay between show retries when the panel returns a partial chunk. */
const SHOW_RETRY_DELAY_MS = 400

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
  onDeviceStatusChange,
}) {
  const { toast } = useToast()
  const { enableDevice, disableDevice } = useFirePanelMonitor()
  const panelConnected = useFirePanelStore((s) => s.connected)
  const sendPanelCommand = useFirePanelStore((s) => s.sendCommand)
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false)
  const [isLoadingPanelStatus, setIsLoadingPanelStatus] = useState(false)
  const [deviceLocation, setDeviceLocation] = useState("")
  const [deviceAddress, setDeviceAddress] = useState("")
  const [deviceDescription, setDeviceDescription] = useState("")
  const [primaryStatus, setPrimaryStatus] = useState("")
  const [enabledState, setEnabledState] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [selectedAsset, setSelectedAsset] = useState(null)

  // Bump this to ignore late responses from a previous open / asset / refresh.
  const statusRequestIdRef = useRef(0)
  const prevConnectedRef = useRef(panelConnected)
  const fetchPanelShowStatusRef = useRef(null)

  /** Run `show <address>` and parse PRIMARY STATUS / ENABLED STATE. */
  const runPanelShow = useCallback(
    async (trimmedAddress) => {
      const result = await withMonitorPaused(async () => {
        return sendPanelCommand(`show ${trimmedAddress}`)
      })
      if (!result?.ok) {
        throw new Error(useFirePanelStore.getState().lastError || "Panel show command failed")
      }

      // Prefer the command result — shared rawResponse can be overwritten by CVAL polls.
      const response = result.response || useFirePanelStore.getState().rawResponse || ""
      console.log(`[show ${trimmedAddress}] response:\n${response}`)
      return parsePanelShowResponse(response)
    },
    [sendPanelCommand],
  )

  const fetchPanelShowStatus = useCallback(
    async (address, assetRef) => {
      const trimmed = String(address || "").trim()
      if (!trimmed) return

      // Read live connection state (avoid a stale closed-over value).
      if (!useFirePanelStore.getState().connected) return

      const requestId = ++statusRequestIdRef.current
      setIsLoadingPanelStatus(true)

      /** One show attempt — incomplete PRIMARY/ENABLED counts as failure so we can retry. */
      const attemptShow = async () => {
        const parsed = await runPanelShow(trimmed)
        if (!parsed.primaryStatus && !parsed.enabledState) {
          throw new Error("incomplete show response")
        }
        return parsed
      }

      try {
        let parsed
        try {
          parsed = await attemptShow()
        } catch (firstError) {
          // Common when CVAL monitoring and Asset Control race on the telnet socket.
          console.warn("[show] first attempt failed, retrying once", {
            address: trimmed,
            error: firstError?.message,
          })
          await new Promise((resolve) => setTimeout(resolve, SHOW_RETRY_DELAY_MS))
          if (requestId !== statusRequestIdRef.current) return
          parsed = await attemptShow()
        }

        // Modal closed or a newer request started — drop this result.
        if (requestId !== statusRequestIdRef.current) return

        if (parsed.primaryStatus) {
          setPrimaryStatus(parsed.primaryStatus)
        }
        if (parsed.enabledState) {
          setEnabledState(parsed.enabledState)
        }
        // ENABLED STATE / PRIMARY STATUS are for this modal only.
        // Floor-map marker colors come from monitoring list F/T — never from `show`.
        if (parsed.enabled !== null) {
          setEnabled(parsed.enabled)
        }
      } catch (error) {
        if (requestId !== statusRequestIdRef.current) return
        console.error("Panel show command failed:", error)
        const incomplete = /incomplete show response/i.test(error?.message || "")
        toast({
          title: incomplete ? "Panel status incomplete" : "Could not read panel status",
          description: incomplete
            ? "Show returned without PRIMARY STATUS / ENABLED STATE. Try refresh."
            : error.message || "show command failed",
          variant: "destructive",
        })
      } finally {
        if (requestId === statusRequestIdRef.current) {
          setIsLoadingPanelStatus(false)
        }
      }
    },
    [asset, runPanelShow, toast],
  )

  fetchPanelShowStatusRef.current = fetchPanelShowStatus

  // Stable key so parent re-renders with a new asset object do not re-trigger load.
  const assetKey = asset?.buildingAssetId || asset?.id || ""

  // Hold monitor pause for the whole time this modal is open.
  // Otherwise CVAL polling resumes between show attempts and corrupts the telnet reply.
  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    pauseMonitorLoop()

    const prepare = async () => {
      await waitForMonitorYield()
      if (cancelled) return
    }
    void prepare()

    return () => {
      cancelled = true
      resumeMonitorLoop()
    }
  }, [isOpen])

  // Load Firestore asset fields, then auto-fetch live panel status.
  useEffect(() => {
    if (!isOpen || !asset || !selectedBuilding) return

    let cancelled = false
    const loadId = ++statusRequestIdRef.current

    // Clear previous status immediately so we never flash the last asset's values.
    setPrimaryStatus("")
    setEnabledState("")
    setIsLoadingPanelStatus(false)

    const loadAssetData = async () => {
      try {
        // Wait until CVAL cycle yields under the held pause before reading Firestore + show.
        await waitForMonitorYield()
        if (cancelled || loadId !== statusRequestIdRef.current) return

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
        if (cancelled || loadId !== statusRequestIdRef.current) return

        const assetData = assetDoc.exists() ? assetDoc.data() : {}

        // Prefer mapping address, then building DB — AssetsList fills gaps below.
        let address =
          asset.deviceAddress ||
          assetData.deviceAddress ||
          asset.details?.deviceAddress ||
          ""
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
        if (cancelled || loadId !== statusRequestIdRef.current) return

        if (assetsListId) {
          const listSnap = await getDoc(doc(db, "AssetsList", assetsListId))
          if (cancelled || loadId !== statusRequestIdRef.current) return
          if (listSnap.exists()) {
            const listData = listSnap.data()
            if (!description) {
              description = listData.deviceDescription || listData.description || ""
            }
            // Only use explicit deviceLocation from AssetsList — never description.
            if (!location) {
              location = String(listData.deviceLocation || "").trim()
            }
            // Without an address, `show` never runs and Current Device Status stays empty.
            if (!String(address || "").trim()) {
              address =
                listData.deviceAddress ||
                listData.partNumber ||
                ""
            }
          }
        }

        const enabledStatus = assetData.enabled !== undefined ? assetData.enabled : true

        useDeviceEnabledStore.getState().setEnabled(address, enabledStatus)

        const descTrimmed = description.trim()
        if (location && descTrimmed && location.toLowerCase() === descTrimmed.toLowerCase()) {
          location = ""
        }

        const nextSelectedAsset = {
          ...asset,
          buildingAssetId: assetId,
          assetCategory: categoryKey,
          deviceAddress: address || asset.deviceAddress || "",
          assetsListId: assetsListId || asset.assetsListId || "",
        }

        setDeviceAddress(address)
        setDeviceDescription(description)
        setEnabled(enabledStatus)
        setDeviceLocation(location)
        setSelectedAsset(nextSelectedAsset)

        if (address) {
          void fetchPanelShowStatusRef.current?.(address, nextSelectedAsset)
        }
      } catch (error) {
        if (cancelled || loadId !== statusRequestIdRef.current) return
        console.error("Error loading asset data:", error)
        toast({
          title: "Error",
          description: "Failed to load asset details",
          variant: "destructive",
        })
      }
    }

    void loadAssetData()

    return () => {
      cancelled = true
    }
    // assetKey stands in for asset identity; read latest `asset` from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid reload on new object refs
  }, [isOpen, assetKey, selectedBuilding, toast])

  // If the panel connects while this modal is already open, fetch status then.
  useEffect(() => {
    const wasConnected = prevConnectedRef.current
    prevConnectedRef.current = panelConnected

    if (!isOpen || !panelConnected || wasConnected) return
    const address = String(deviceAddress || "").trim()
    if (!address) return

    void fetchPanelShowStatus(address, selectedAsset)
  }, [isOpen, panelConnected, deviceAddress, selectedAsset, fetchPanelShowStatus])

  useEffect(() => {
    if (!isOpen) {
      // Invalidate any in-flight show / Firestore load.
      statusRequestIdRef.current += 1
      setDeviceLocation("")
      setDeviceAddress("")
      setDeviceDescription("")
      setPrimaryStatus("")
      setEnabledState("")
      setEnabled(true)
      setSelectedAsset(null)
      setIsLoadingPanelStatus(false)
    }
  }, [isOpen])

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
      onDeviceStatusChange?.({
        assetId: selectedAsset.buildingAssetId,
        deviceAddress: address,
        enabled: true,
      })
      toast({
        title: "Success",
        description: "Device enabled successfully",
      })
      void fetchPanelShowStatus(address, selectedAsset)
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
      onDeviceStatusChange?.({
        assetId: selectedAsset.buildingAssetId,
        deviceAddress: address,
        enabled: false,
      })
      toast({
        title: "Success",
        description: "Device disabled successfully",
      })
      void fetchPanelShowStatus(address, selectedAsset)
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

  const statusTone = getPrimaryStatusTone(primaryStatus)
  const statusToneClass =
    statusTone === "fire"
      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
      : statusTone === "trouble"
        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
        : statusTone === "supervisory"
          ? "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300"
          : statusTone === "normal"
            ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
            : "border-muted bg-muted/40 text-muted-foreground"

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

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-semibold">Current Device Status</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    disabled={isLoadingPanelStatus || !deviceAddress.trim() || !panelConnected}
                    onClick={() => fetchPanelShowStatus(deviceAddress, selectedAsset)}
                  >
                    {isLoadingPanelStatus ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className={cn("rounded-lg border px-3 py-2.5 text-sm font-medium", statusToneClass)}>
                  {isLoadingPanelStatus ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Reading panel status...
                    </span>
                  ) : primaryStatus ? (
                    primaryStatus
                  ) : panelConnected ? (
                    "Status not available"
                  ) : (
                    "Connect to fire panel to read live status"
                  )}
                </div>
                {enabledState ? (
                  <p className="text-xs text-muted-foreground">
                    Panel ENABLED STATE: {enabledState}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Enable / Disable</Label>

                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                    enabled
                      ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
                      : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
                  )}
                >
                  {enabled ? (
                    <CheckCircle className="h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span>Device is {enabled ? "Enabled" : "Disabled"}</span>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleEnable}
                    disabled={isUpdatingAsset || enabled || !deviceAddress.trim()}
                    className={cn(
                      "flex-1",
                      enabled
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : "border-green-600/30 bg-background text-green-700 hover:bg-green-500/10",
                    )}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Enable
                  </Button>
                  <Button
                    onClick={handleDisable}
                    disabled={isUpdatingAsset || !enabled || !deviceAddress.trim()}
                    className={cn(
                      "flex-1",
                      !enabled
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "border-red-600/30 bg-background text-red-700 hover:bg-red-500/10",
                    )}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Disable
                  </Button>
                </div>
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
