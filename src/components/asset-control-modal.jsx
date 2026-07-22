"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { db } from "@/config/firebase"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useFirePanelMonitor } from "@/contexts/AppContext"
import { useFirePanelStore } from "@/stores/firePanelStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { Loader2, Edit, MapPin, CheckCircle, XCircle, RefreshCcw, Hash, FileText, Save } from "lucide-react"
import { resolveAssetsListDocId } from "@/lib/assetsListSimplexStatus"
import { useDeviceEnabledStore } from "@/stores/deviceEnabledStore"
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore"
import { useShallow } from "zustand/react/shallow"
import {
  getPrimaryStatusTone,
  parsePanelShowResponse,
  primaryStatusToSimplex,
} from "@/lib/parsePanelShowResponse"
import { withMonitorPausedForPriority, pauseMonitorLoop, resumeMonitorLoop } from "@/lib/firePanelMonitorSession"
import { cn } from "@/lib/utils"

/** Small delay between show retries when the panel returns a partial chunk. */
const SHOW_RETRY_DELAY_MS = 400

/**
 * Backup device status from monitoring F/T when `show` PRIMARY STATUS is missing.
 * F=1 → FIRE ALARM; T=1 → DISABLE TROUBLE; otherwise NORMAL.
 */
function statusLabelFromFT(F = 0, T = 0) {
  if (Number(F) === 1) return "FIRE ALARM"
  if (Number(T) === 1) return "DISABLE TROUBLE"
  return "NORMAL"
}

/** Push parsed PRIMARY STATUS into the marker store (lowest priority tier). */
function syncShowStatusToMarkers(address, primaryStatus, assetRef) {
  const trimmed = String(address || "").trim()
  if (!trimmed) return

  let status = primaryStatus
    ? primaryStatusToSimplex(primaryStatus)
    : null

  if (!status) {
    const assetId =
      assetRef?.buildingAssetId ||
      assetRef?.assetsListId ||
      assetRef?.id ||
      ""
    const cached = useAssetFireStatusStore
      .getState()
      .getSimplexStatus(assetId, trimmed)
    if (cached) {
      status = cached
    }
  }

  if (status) {
    useAssetFireStatusStore.getState().patchShowStatusForAddress(trimmed, status)
  }
}

/** Read cached F/T for this asset address and return a display label. */
function backupStatusFromFT(address, assetRef) {
  const assetId =
    assetRef?.buildingAssetId ||
    assetRef?.assetsListId ||
    assetRef?.id ||
    ""
  const status = useAssetFireStatusStore
    .getState()
    .getSimplexStatus(assetId, address)

  if (!status) return statusLabelFromFT(0, 0)

  return statusLabelFromFT(status.F, status.T)
}

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
  // Keep admin edits while the modal stays open (load can otherwise overwrite with stale mapping props).
  const savedFieldsRef = useRef({ address: null, description: null, location: null })

  /** Run `show <address>` and parse PRIMARY STATUS / ENABLED STATE. */
  const runPanelShow = useCallback(
    async (trimmedAddress) => {
      // Do not wait for an in-flight list dump — worker preempts list for show.
      const result = await withMonitorPausedForPriority(async () => {
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
      if (!useFirePanelStore.getState().connected) {
        // Panel offline — still show F/T backup so status is not stuck empty.
        const backupLabel = backupStatusFromFT(trimmed, assetRef)
        setPrimaryStatus(backupLabel)
        syncShowStatusToMarkers(trimmed, backupLabel, assetRef)
        return
      }

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
          syncShowStatusToMarkers(trimmed, parsed.primaryStatus, assetRef)
        } else {
          // Show worked for ENABLED STATE but missed PRIMARY STATUS — use F/T.
          const backupLabel = backupStatusFromFT(trimmed, assetRef)
          setPrimaryStatus(backupLabel)
          syncShowStatusToMarkers(trimmed, backupLabel, assetRef)
          console.warn("[show] missing PRIMARY STATUS, using F/T backup:", backupLabel)
        }
        if (parsed.enabledState) {
          setEnabledState(parsed.enabledState)
        }
        if (parsed.enabled !== null) {
          setEnabled(parsed.enabled)
        }
      } catch (error) {
        if (requestId !== statusRequestIdRef.current) return
        console.error("Panel show command failed:", error)

        // Backup: monitoring F/T values when show response is not usable.
        const backupLabel = backupStatusFromFT(trimmed, assetRef)
        setPrimaryStatus(backupLabel)
        syncShowStatusToMarkers(trimmed, backupLabel, assetRef)
        console.warn("[show] failed, using F/T backup status:", backupLabel)

        const incomplete = /incomplete show response/i.test(error?.message || "")
        toast({
          title: incomplete ? "Panel status incomplete" : "Could not read panel status",
          description: incomplete
            ? `Show returned without PRIMARY STATUS / ENABLED STATE. Showing F/T backup: ${backupLabel}.`
            : `${error.message || "show command failed"}. Showing F/T backup: ${backupLabel}.`,
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
  const prevAssetKeyRef = useRef(assetKey)

  // Drop in-session saved edits when switching to a different asset (or closing).
  useEffect(() => {
    if (!isOpen) {
      prevAssetKeyRef.current = ""
      return
    }
    if (prevAssetKeyRef.current !== assetKey) {
      savedFieldsRef.current = { address: null, description: null, location: null }
      prevAssetKeyRef.current = assetKey
    }
  }, [isOpen, assetKey])

  // Hold monitor pause for the whole time this modal is open.
  // Otherwise CVAL polling resumes between show attempts and corrupts the telnet reply.
  useEffect(() => {
    if (!isOpen) return

    pauseMonitorLoop()

    return () => {
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
        // Do not wait out a long list dump here — `show` preempts it in the worker.
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

        // Prefer Firestore (building DB) over floor-mapping props — mapping can be stale after admin edits.
        let address =
          assetData.deviceAddress ||
          asset.deviceAddress ||
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
            // Fill gaps only — do not overwrite fresher building-DB values with older list data.
            if (!String(address || "").trim()) {
              address =
                listData.deviceAddress ||
                listData.partNumber ||
                ""
            }
            if (!String(description || "").trim()) {
              description =
                listData.deviceDescription ||
                listData.description ||
                ""
            }
            // Only use explicit deviceLocation from AssetsList — never description.
            if (!location && listData.deviceLocation) {
              location = String(listData.deviceLocation || "").trim()
            }
          }
        }

        // Re-apply values saved in this open session (beats any stale mapping / racey reload).
        if (savedFieldsRef.current.address != null) {
          address = savedFieldsRef.current.address
        }
        if (savedFieldsRef.current.description != null) {
          description = savedFieldsRef.current.description
        }
        if (savedFieldsRef.current.location != null) {
          location = savedFieldsRef.current.location
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
          deviceDescription: description || "",
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
      savedFieldsRef.current = { address: null, description: null, location: null }
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



  /** Shared path to the building asset document currently open in this modal. */
  const getBuildingAssetDocRef = () => {
    const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
    return doc(
      db,
      buildingNameWithSuffix,
      "asset",
      selectedAsset.assetCategory,
      selectedAsset.buildingAssetId,
    )
  }

  /**
   * Also write to AssetsList when this asset is linked there.
   * Address / description are often read from AssetsList as a fallback.
   */
  const updateLinkedAssetsList = async (fields) => {
    const listId = selectedAsset?.assetsListId
    if (!listId) return
    await updateDoc(doc(db, "AssetsList", listId), {
      ...fields,
      updatedAt: new Date().toISOString(),
    })
  }

  /** Save address, description, and location in one write (admin only). */
  const handleSaveDeviceDetails = async () => {
    if (!selectedAsset || !selectedBuilding || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update device details",
        variant: "destructive",
      })
      return
    }

    const nextAddress = deviceAddress.trim()
    if (!nextAddress) {
      toast({
        title: "Missing Address",
        description: "Device address cannot be empty",
        variant: "destructive",
      })
      return
    }

    const nextDescription = deviceDescription.trim()
    const nextLocation = deviceLocation.trim()
    const previousAddress = String(selectedAsset.deviceAddress || "").trim()

    setIsUpdatingAsset(true)
    try {
      const now = new Date().toISOString()
      // One Firestore write for all three editable fields.
      await updateDoc(getBuildingAssetDocRef(), {
        deviceAddress: nextAddress,
        deviceDescription: nextDescription,
        description: nextDescription,
        deviceLocation: nextLocation,
        updatedAt: now,
      })
      await updateLinkedAssetsList({
        deviceAddress: nextAddress,
        deviceDescription: nextDescription,
        description: nextDescription,
        deviceLocation: nextLocation,
      })

      // Remember edits so a background reload cannot restore stale mapping values.
      savedFieldsRef.current = {
        address: nextAddress,
        description: nextDescription,
        location: nextLocation,
      }

      const nextSelectedAsset = {
        ...selectedAsset,
        deviceAddress: nextAddress,
        deviceDescription: nextDescription,
        description: nextDescription,
        deviceLocation: nextLocation,
        details: selectedAsset.details
          ? { ...selectedAsset.details, deviceAddress: nextAddress }
          : selectedAsset.details,
      }
      setSelectedAsset(nextSelectedAsset)
      setDeviceAddress(nextAddress)
      setDeviceDescription(nextDescription)
      setDeviceLocation(nextLocation)

      onDeviceStatusChange?.({
        assetId: selectedAsset.buildingAssetId,
        deviceAddress: nextAddress,
        deviceDescription: nextDescription,
        enabled,
      })

      toast({
        title: "Success",
        description: "Device details saved successfully",
      })

      // Only re-run panel show when the address actually changed.
      if (nextAddress !== previousAddress) {
        void fetchPanelShowStatus(nextAddress, nextSelectedAsset)
      }
    } catch (error) {
      console.error("Error saving device details:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to save device details",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingAsset(false)
    }
  }

  // Resolve F/T/S the same way floor markers do (AssetsList + live panel).
  const assetIdForStatus =
    selectedAsset?.buildingAssetId ||
    selectedAsset?.assetsListId ||
    selectedAsset?.id ||
    asset?.buildingAssetId ||
    asset?.id ||
    ""
  const addressForStatus = String(deviceAddress || "").trim()

  // Re-read when cache maps change so values stay live while the modal is open.
  const simplexFTS = useAssetFireStatusStore(
    useShallow((s) => {
      void s.byDeviceAddress
      void s.byAssetId
      void s.panelLiveByAddress
      const status = s.getSimplexStatus(assetIdForStatus, addressForStatus)
      return {
        F: Number(status?.F ?? 0),
        T: Number(status?.T ?? 0),
        S: Number(status?.S ?? 0),
      }
    }),
  )

  if (!asset) return null

  // Default to NORMAL when show has not returned a status yet.
  const displayPrimaryStatus = primaryStatus || "NORMAL"
  const statusTone = getPrimaryStatusTone(displayPrimaryStatus)
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

  // Highlight each flag when it is active (1).
  const ftsBadgeClass = (active, activeClass) =>
    cn(
      "flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-3 py-2",
      active ? activeClass : "border-muted bg-muted/40 text-muted-foreground",
    )

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
              <div className="space-y-2">
                <Label htmlFor="deviceAddress" className="text-sm font-semibold flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Device Address
                </Label>
                <Input
                  id="deviceAddress"
                  value={deviceAddress}
                  onChange={(e) => setDeviceAddress(e.target.value)}
                  placeholder="Enter device address (e.g. M1-2-0)"
                  disabled={isUpdatingAsset}
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deviceDescription" className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Device Description
                </Label>
                <Textarea
                  id="deviceDescription"
                  value={deviceDescription}
                  onChange={(e) => setDeviceDescription(e.target.value)}
                  placeholder="Enter device description"
                  disabled={isUpdatingAsset}
                  rows={3}
                />
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
                  ) : (
                    displayPrimaryStatus
                  )}
                </div>
                {enabledState ? (
                  <p className="text-xs text-muted-foreground">
                    Panel ENABLED STATE: {enabledState}
                  </p>
                ) : null}
              </div>

              {/* Asset simplex flags from AssetsList / live panel monitor */}
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Asset Status (F / T / S)</Label>
                <div className="flex gap-2">
                  <div
                    className={ftsBadgeClass(
                      Number(simplexFTS.F) === 1,
                      "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
                    )}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                      F
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums leading-none">
                      {Number(simplexFTS.F) || 0}
                    </span>
                  </div>
                  <div
                    className={ftsBadgeClass(
                      Number(simplexFTS.T) === 1,
                      "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
                    )}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                      T
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums leading-none">
                      {Number(simplexFTS.T) || 0}
                    </span>
                  </div>
                  <div
                    className={ftsBadgeClass(
                      Number(simplexFTS.S) === 1,
                      "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
                    )}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                      S
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums leading-none">
                      {Number(simplexFTS.S) || 0}
                    </span>
                  </div>
                </div>
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
          <Button variant="outline" onClick={onClose} disabled={isUpdatingAsset}>
            Close
          </Button>
          {userRole === "admin" ? (
            <Button
              onClick={handleSaveDeviceDetails}
              disabled={isUpdatingAsset || !deviceAddress.trim()}
            >
              {isUpdatingAsset ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
