"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import { AppSidebar } from "@/components/app-sidebar"
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges"
import secureLocalStorage from "react-secure-storage"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Building2,
  Search,
  Loader2,
  Package,
  Flame,
  Zap,
  Wind,
  Droplets,
  Cable,
  Shield,
  MoveVertical,
  Lightbulb,
  Brain,
  Trees,
  Archive,
  Filter,
  Download,
  RefreshCw,
  MapPin,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Trash2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import dynamic from "next/dynamic"
import { useAppData } from "@/hooks/useAppData"
import FirestoreService from "@/services/firestoreService"
import { db } from "@/config/firebase"
import { doc, getDoc, deleteDoc, collection, getDocs } from "firebase/firestore"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"


// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

function normalizeBuildingName(value) {
  return String(value || "").trim().toLowerCase()
}

function getAssetBuildingName(asset) {
  return asset?.building || asset?.buildingName || ""
}

function buildAssetDataFromUploadedList(assets, buildingName) {
  const categories = {}

  assets.forEach((asset) => {
    const categoryKey =
      asset.categoryKey ||
      String(asset.category || "uploaded")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") ||
      "uploaded"

    if (!categories[categoryKey]) {
      categories[categoryKey] = {
        categoryInfo: { name: asset.category || categoryKey },
        assets: {},
      }
    }

    const docId = asset.assetId || asset.id
    categories[categoryKey].assets[docId] = {
      ...asset,
      id: docId,
      assetName: asset.assetName || asset.itemType || asset.description || docId,
      buildingAssetId: asset.buildingAssetId || asset.assetId || asset.id,
      mainCategory: asset.mainCategory || asset.category || "",
      partModelNumber: asset.partModelNumber || asset.model || asset.partNumber || "",
      status: asset.status || "Active",
      categoryKey,
    }
  })

  return {
    buildingName,
    totalAssets: assets.length,
    categoriesFound: Object.keys(categories),
    categories,
    status: true,
  }
}

// Asset category icons mapping
const categoryIcons = {
  "fire-life-safety": Flame,
  electrical: Zap,
  hvac: Wind,
  plumbing: Droplets,
  elv: Cable,
  security: Shield,
  "vertical-transport": MoveVertical,
  lighting: Lightbulb,
  bms: Brain,
  landscaping: Trees,
  additional: Archive,
}

const categoryColors = {
  "fire-life-safety": "bg-red-500",
  electrical: "bg-yellow-500",
  hvac: "bg-blue-500",
  plumbing: "bg-cyan-500",
  elv: "bg-purple-500",
  security: "bg-gray-700",
  "vertical-transport": "bg-indigo-500",
  lighting: "bg-amber-500",
  bms: "bg-emerald-500",
  landscaping: "bg-green-600",
  additional: "bg-slate-500",
}

const VIEW_ASSETS_SELECTION_KEY = "vision365-view-assets-selection"

export default function ViewAssetsPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const { communities, isLoadingCommunities, isReady } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [selectedCommunity, setSelectedCommunity] = useState("")
  const [buildings, setBuildings] = useState([])
  const [selectedBuilding, setSelectedBuilding] = useState("")
  const [assetData, setAssetData] = useState(null)
  const [boqAssets, setBoqAssets] = useState([])
  const [buildingTotalCount, setBuildingTotalCount] = useState(null)
  const [isLoadingAssets, setIsLoadingAssets] = useState(false)
  const [isLoadingBoq, setIsLoadingBoq] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [boqDeviceAddressSearch, setBoqDeviceAddressSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [selectedSubCategory, setSelectedSubCategory] = useState("all")
  const [isUploadingCoordinates, setIsUploadingCoordinates] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, matched: 0 })
  const [selectionReady, setSelectionReady] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [deletingRowKey, setDeletingRowKey] = useState(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const { toast } = useToast()

  // Add this useEffect to handle mounting
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isReady || communities.length === 0) {
      if (isReady) setSelectionReady(true)
      return
    }
    try {
      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(VIEW_ASSETS_SELECTION_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          const communityId = parsed.communityId
          const building = parsed.building
          if (communityId && typeof communityId === "string") {
            const community = communities.find((c) => c.id === communityId)
            if (community) {
              setSelectedCommunity(communityId)
              const bList = community.buildings || []
              if (building && typeof building === "string" && bList.includes(building)) {
                setSelectedBuilding(building)
              }
            }
          }
        }
      }
    } catch {
      // ignore invalid saved selection
    }
    if (!selectedCommunity && communities[0]?.id) {
      setSelectedCommunity(communities[0].id)
    }
    setSelectionReady(true)
  }, [isReady, communities])

  // Update buildings when community is selected; keep building if it still exists for that community
  useEffect(() => {
    if (selectedCommunity) {
      const community = communities.find((c) => c.id === selectedCommunity)
      if (community) {
        const newBuildings = community.buildings || []
        setBuildings(newBuildings)
        setSelectedBuilding((prev) => (prev && newBuildings.includes(prev) ? prev : ""))
      }
    } else {
      setBuildings([])
      setSelectedBuilding("")
      setAssetData(null)
      setBoqAssets([])
    }
  }, [selectedCommunity, communities])

  // Persist community + building for next visit (skip until communities loaded / restore attempted)
  useEffect(() => {
    if (!mounted || !selectionReady || typeof window === "undefined") return
    try {
      if (selectedCommunity && selectedBuilding) {
        window.localStorage.setItem(
          VIEW_ASSETS_SELECTION_KEY,
          JSON.stringify({ communityId: selectedCommunity, building: selectedBuilding })
        )
      } else if (selectedCommunity) {
        window.localStorage.setItem(
          VIEW_ASSETS_SELECTION_KEY,
          JSON.stringify({ communityId: selectedCommunity, building: "" })
        )
      } else {
        window.localStorage.removeItem(VIEW_ASSETS_SELECTION_KEY)
      }
    } catch {
      // ignore quota / private mode
    }
  }, [mounted, selectionReady, selectedCommunity, selectedBuilding])

  // Fetch assets when building is selected
  useEffect(() => {
    if (selectedBuilding) {
      fetchAssets()
    } else {
      setAssetData(null)
      setBoqAssets([])
      setBuildingTotalCount(null)
    }
  }, [selectedBuilding])

  useEffect(() => {
    setSelectedRowKeys([])
    setBoqDeviceAddressSearch("")
  }, [selectedBuilding])

  // Fetch building summary totalAssetsCount when building is selected
  useEffect(() => {
    let mounted = true
    const loadBuildingSummary = async () => {
      if (!selectedBuilding) {
        setBuildingTotalCount(null)
        return
      }
      
      // Ensure buildingName has BuildingDB suffix
      const buildingDbName = selectedBuilding.endsWith('BuildingDB') 
        ? selectedBuilding 
        : `${selectedBuilding}BuildingDB`
      
      try {
        // Try to fetch from {buildingName}BuildingDB/buildingSummary
        const summaryRef = doc(db, buildingDbName, "buildingSummary")
        const snap = await getDoc(summaryRef)
        if (snap.exists() && mounted) {
          const data = snap.data() || {}
          // Use totalAssetsCount (from BOQ creation) or fallback to totalAssets
          setBuildingTotalCount(data.totalAssetsCount ?? data.totalAssets ?? null)
        } else {
          setBuildingTotalCount(null)
        }
      } catch (err) {
        console.error("Error loading building summary:", err)
        setBuildingTotalCount(null)
      }
    }
    loadBuildingSummary()
    return () => { mounted = false }
  }, [selectedBuilding])

  const assetRowKey = (asset) => `${asset.categoryKey}::${asset.id || asset.buildingAssetId || ""}`

  const getBuildingDbName = () => {
    if (!selectedBuilding) return ""
    return selectedBuilding.endsWith("BuildingDB") ? selectedBuilding : `${selectedBuilding}BuildingDB`
  }

  const getBuildingAssetDocRef = (asset) => {
    const buildingDb = getBuildingDbName()
    const categoryKey = asset.categoryKey
    const docId = asset.id || asset.buildingAssetId
    if (!buildingDb || !categoryKey || !docId) return null
    return doc(db, buildingDb, "asset", categoryKey, docId)
  }

  const removeAssetFromLocalState = (asset) => {
    const docId = asset.id || asset.buildingAssetId
    const cat = asset.categoryKey
    if (!docId || !cat) return

    setBoqAssets((prev) =>
      prev.filter((a) => !((a.categoryKey || "") === cat && (a.id || a.buildingAssetId) === docId)),
    )

    setAssetData((prev) => {
      if (!prev?.categories?.[cat]?.assets) return prev
      const assets = prev.categories[cat].assets
      const matchEntry = Object.entries(assets).find(
        ([id, val]) => id === docId || val?.buildingAssetId === docId || val?.id === docId,
      )
      if (!matchEntry) return prev
      const [removeId] = matchEntry
      const nextAssets = { ...assets }
      delete nextAssets[removeId]
      return {
        ...prev,
        totalAssets: Math.max(0, (prev.totalAssets || 0) - 1),
        categories: {
          ...prev.categories,
          [cat]: {
            ...prev.categories[cat],
            assets: nextAssets,
          },
        },
      }
    })
  }

  const handleDeleteBuildingAsset = async (asset, e) => {
    e?.stopPropagation?.()
    const docRef = getBuildingAssetDocRef(asset)
    if (!docRef) {
      toast({
        title: "Cannot delete",
        description: "Missing building, category, or asset id for this row.",
        variant: "destructive",
      })
      return
    }

    const label = asset.assetName || asset.id || asset.buildingAssetId || "this asset"
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return

    const key = assetRowKey(asset)
    setDeletingRowKey(key)
    try {
      await deleteDoc(docRef)
      removeAssetFromLocalState(asset)
      setSelectedRowKeys((prev) => prev.filter((k) => k !== key))
      toast({ title: "Asset deleted", description: `"${label}" was removed.` })
    } catch (err) {
      console.error("Delete asset failed:", err)
      toast({
        title: "Delete failed",
        description: err?.message || "Could not delete the asset.",
        variant: "destructive",
      })
    } finally {
      setDeletingRowKey(null)
    }
  }

  const handleBulkDeleteBuildingAssets = async () => {
    if (selectedRowKeys.length === 0) return
    if (
      !window.confirm(
        `Delete ${selectedRowKeys.length} selected asset(s)? This cannot be undone.`,
      )
    ) {
      return
    }

    setIsBulkDeleting(true)
    const selectedSet = new Set(selectedRowKeys)
    const toRemove = boqAssets.filter((a) => selectedSet.has(assetRowKey(a)))
    let deleted = 0
    const failures = []

    for (const asset of toRemove) {
      const docRef = getBuildingAssetDocRef(asset)
      if (!docRef) {
        failures.push(asset.assetName || asset.id)
        continue
      }
      try {
        await deleteDoc(docRef)
        removeAssetFromLocalState(asset)
        deleted++
      } catch (err) {
        console.error("Bulk delete failed for asset:", asset, err)
        failures.push(asset.assetName || asset.id || "unknown")
      }
    }

    setSelectedRowKeys([])
    setIsBulkDeleting(false)

    if (deleted > 0) {
      toast({
        title: "Bulk delete complete",
        description:
          failures.length === 0
            ? `Removed ${deleted} asset(s).`
            : `Removed ${deleted} asset(s). Failed: ${failures.length}.`,
      })
    }
    if (failures.length > 0 && deleted === 0) {
      toast({
        title: "Bulk delete failed",
        description: "No assets were deleted. Check permissions and try again.",
        variant: "destructive",
      })
    }
  }

  const toggleRowSelected = (asset, checked) => {
    const key = assetRowKey(asset)
    setSelectedRowKeys((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key]
      return prev.filter((k) => k !== key)
    })
  }

  const getFilteredBoqAssets = () => {
    const query = boqDeviceAddressSearch.trim().toLowerCase()
    if (!query) return boqAssets
    return boqAssets.filter((asset) =>
      String(asset.deviceAddress || "").toLowerCase().includes(query),
    )
  }

  const toggleSelectAllBoq = (checked) => {
    const visibleAssets = getFilteredBoqAssets()
    const visibleKeys = visibleAssets.map((a) => assetRowKey(a))
    if (!checked) {
      setSelectedRowKeys((prev) => prev.filter((k) => !visibleKeys.includes(k)))
      return
    }
    setSelectedRowKeys((prev) => [...new Set([...prev, ...visibleKeys])])
  }

  const fetchAssets = async () => {
    if (!selectedBuilding) {
      toast({
        title: "Error",
        description: "No building selected",
        variant: "destructive",
      })
      return
    }

    setIsLoadingAssets(true)
    setIsLoadingBoq(true)
    
    const buildingNameForFirestore = selectedBuilding.endsWith('BuildingDB') 
      ? selectedBuilding.replace('BuildingDB', '')
      : selectedBuilding
    
    console.log("Fetching assets for building:", buildingNameForFirestore)
    
    try {
      const snapshot = await getDocs(collection(db, "AssetsList"))
      const targetBuilding = normalizeBuildingName(buildingNameForFirestore)

      const matchedAssets = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((asset) => normalizeBuildingName(getAssetBuildingName(asset)) === targetBuilding)

      console.log("Assets from AssetsList:", matchedAssets)

      if (matchedAssets.length === 0) {
        setAssetData({
          buildingName: buildingNameForFirestore,
          totalAssets: 0,
          categoriesFound: [],
          categories: {},
          status: false,
        })
        setBoqAssets([])
        toast({
          title: "Info",
          description: "No assets found for this building",
        })
        return
      }

      const assetPayload = buildAssetDataFromUploadedList(
        matchedAssets,
        buildingNameForFirestore,
      )

      setAssetData(assetPayload)

      const flat = matchedAssets.map((asset) => ({
        ...asset,
        categoryKey: asset.categoryKey || "uploaded",
        assetName: asset.assetName || asset.itemType || asset.description || asset.assetId,
        buildingAssetId: asset.buildingAssetId || asset.assetId || asset.id,
        mainCategory: asset.mainCategory || asset.category || "",
        partModelNumber: asset.partModelNumber || asset.model || asset.partNumber || "",
        status: asset.status || "Active",
      }))
      setBoqAssets(flat)

      console.log(`Loaded ${flat.length} assets for building ${buildingNameForFirestore}`)
      toast({
        title: "Success",
        description: `Successfully loaded ${flat.length} assets`,
      })
    } catch (error) {
      console.error("Error fetching assets:", error)
      const errorMessage = error.message || "Failed to fetch building assets"
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
      setAssetData(null)
      setBoqAssets([])
    } finally {
      setIsLoadingAssets(false)
      setIsLoadingBoq(false)
    }
  }

  // Filter assets based on search and category filters
  const getFilteredAssets = () => {
    if (!assetData?.categories) return []

    const filteredAssets = []

    Object.entries(assetData.categories).forEach(([categoryKey, categoryData]) => {
      if (selectedCategory !== "all" && selectedCategory !== categoryKey) return

      Object.entries(categoryData.assets || {}).forEach(([assetId, asset]) => {
        if (selectedSubCategory !== "all" && selectedSubCategory !== asset.subCategory) return

        if (
          searchTerm === "" ||
          asset.assetName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          asset.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          asset.subCategory?.toLowerCase().includes(searchTerm.toLowerCase())
        ) {
          filteredAssets.push({
            ...asset,
            categoryKey,
            categoryInfo: categoryData.categoryInfo,
          })
        }
      })
    })

    return filteredAssets
  }

  // Get unique subcategories for filter
  const getSubCategories = () => {
    if (!assetData?.categories) return []

    const subCategories = new Set()
    Object.values(assetData.categories).forEach((categoryData) => {
      Object.values(categoryData.assets || {}).forEach((asset) => {
        if (asset.subCategory) {
          subCategories.add(asset.subCategory)
        }
      })
    })

    return Array.from(subCategories).sort()
  }

  const exportAssets = () => {
    if (!assetData) return

    const csvContent = [
      ["Asset Name", "Category", "Sub Category", "Building", "Document Path"].join(","),
      ...getFilteredAssets().map((asset) =>
        [
          asset.assetName,
          asset.categoryInfo?.name || asset.categoryKey,
          asset.subCategory || "",
          asset.buildingName,
          asset.documentPath || "",
        ]
          .map((field) => `"${field}"`)
          .join(","),
      ),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${selectedBuilding}_assets.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const handleCoordinateFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!selectedBuilding || boqAssets.length === 0) {
      toast({
        title: "Error",
        description: "Please select a building and load its BOQ assets first",
        variant: "destructive",
      })
      return
    }

    setIsUploadingCoordinates(true)
    setUploadProgress({ current: 0, total: 0, matched: 0 })

    try {
      // Read Excel file
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet)

      console.log(`Parsed ${jsonData.length} rows from Excel file`)

      // Create a map of deviceAddress -> coordinate data
      const coordinateMap = new Map()
      jsonData.forEach((row) => {
        const deviceAddress = row.FA_Device_Address || row.fa_device_address || row.device_address
        if (deviceAddress) {
          coordinateMap.set(deviceAddress.toString().trim(), {
            globalId: row.GlobalId || row.globalId || row.global_id || "",
            x: parseFloat(row.X || row.x || 0),
            y: parseFloat(row.Y || row.y || 0),
            z: parseFloat(row.Z || row.z || 0),
            ifcType: row.IfcType || row.ifcType || row.ifc_type || "",
            name: row.Name || row.name || "",
            tag: row.Tag || row.tag || "",
            storey: row.Storey || row.storey || "",
          })
        }
      })

      console.log(`Created coordinate map with ${coordinateMap.size} entries`)

      // Match and update assets
      const buildingNameForFirestore = selectedBuilding.endsWith('BuildingDB')
        ? selectedBuilding.replace('BuildingDB', '')
        : selectedBuilding

      let matchedCount = 0
      let updatedCount = 0
      const updates = []

      setUploadProgress({ current: 0, total: boqAssets.length, matched: 0 })

      for (let i = 0; i < boqAssets.length; i++) {
        const asset = boqAssets[i]
        const deviceAddress = asset.deviceAddress?.toString().trim()

        if (deviceAddress && coordinateMap.has(deviceAddress)) {
          matchedCount++
          const coordData = coordinateMap.get(deviceAddress)

          // Prepare update data
          const updateData = {
            coordinates: {
              x: coordData.x,
              y: coordData.y,
              z: coordData.z,
            },
            globalId: coordData.globalId,
            ifcType: coordData.ifcType,
            ifcName: coordData.name,
            ifcTag: coordData.tag,
            storey: coordData.storey,
            coordinatesUpdatedAt: new Date().toISOString(),
          }

          updates.push({
            categoryKey: asset.categoryKey,
            assetId: asset.id || asset.buildingAssetId,
            updateData,
          })

          setUploadProgress({ current: i + 1, total: boqAssets.length, matched: matchedCount })
        }
      }

      console.log(`Matched ${matchedCount} assets, preparing to update...`)

      // Batch update to Firestore
      if (updates.length > 0) {
        for (const update of updates) {
          try {
            await FirestoreService.updateAssetCoordinates(
              buildingNameForFirestore,
              update.categoryKey,
              update.assetId,
              update.updateData
            )
            updatedCount++
          } catch (err) {
            console.error(`Failed to update asset ${update.assetId}:`, err)
          }
        }

        toast({
          title: "Success",
          description: `Successfully updated 3D coordinates for ${updatedCount} of ${matchedCount} matched assets`,
        })

        // Refresh BOQ assets to show updated data
        await fetchAssets()
      } else {
        toast({
          title: "Warning",
          description: "No matching assets found by device address",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error processing coordinate file:", error)
      toast({
        title: "Error",
        description: `Failed to process file: ${error.message}`,
        variant: "destructive",
      })
    } finally {
      setIsUploadingCoordinates(false)
      setUploadProgress({ current: 0, total: 0, matched: 0 })
      // Reset file input
      event.target.value = ""
    }
  }

  if (!mounted) {
    return null
  }

  const filteredAssets = getFilteredAssets()
  const filteredBoqAssets = getFilteredBoqAssets()
  const subCategories = getSubCategories()
  const selectedCommunityData = communities.find((c) => c.id === selectedCommunity)
  const selectedBuildingDbName = selectedBuilding
    ? selectedBuilding.endsWith("BuildingDB")
      ? selectedBuilding
      : `${selectedBuilding}BuildingDB`
    : ""

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex min-h-16 shrink-0 items-center gap-3 py-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-8">
            <SidebarTrigger className="-ml-1" />
            <ClientModeToggle />
          </div>
          <div className="ml-auto flex items-center gap-2 px-8">
            <FirePanelStatusBadges />
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <PageHelpBanner />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">View Assets<FaqHelpButton articleId="page-assets-view" size="md" /></h1>
            <p className="text-muted-foreground">View and manage all assets across communities and buildings</p>
          </div>

          {/* Community and Building Selection */}
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Community & Building Selection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Community Selection */}
                <div className="space-y-2">
                  <Label htmlFor="community-select">Community</Label>
                  <Select
                    value={selectedCommunity}
                    onValueChange={setSelectedCommunity}
                    disabled={isLoadingCommunities}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={isLoadingCommunities ? "Loading communities..." : "Select a community"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {communities.map((community) => (
                        <SelectItem key={community.id} value={community.id}>
                          <div className="flex flex-col">
                            <span>{community.communityName}</span>
                            <span className="text-xs text-muted-foreground">{community.totalBuildings} buildings</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCommunityData && (
                    <p className="text-sm text-muted-foreground">
                      {selectedCommunityData.totalBuildings} buildings available
                    </p>
                  )}
                </div>

                {/* Building Selection */}
                <div className="space-y-2">
                  <Label htmlFor="building-select">Building</Label>
                  <div className="flex gap-2">
                    <Select
                      value={selectedBuilding}
                      onValueChange={setSelectedBuilding}
                      disabled={!selectedCommunity || buildings.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            !selectedCommunity
                              ? "Select a community first"
                              : buildings.length === 0
                                ? "No buildings available"
                                : "Select a building"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {buildings.map((building) => (
                          <SelectItem key={building} value={building}>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" />
                              {building}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={fetchAssets}
                      disabled={!selectedBuilding || isLoadingAssets}
                      variant="outline"
                      size="icon"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoadingAssets ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                  {selectedCommunity && buildings.length === 0 && (
                    <p className="text-sm text-muted-foreground">No buildings found in this community</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Loading State */}
          {isLoadingAssets && (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mr-2" />
                <span>Loading assets...</span>
              </CardContent>
            </Card>
          )}

          {/* No Community Selected */}
          {!selectedCommunity && !isLoadingAssets && (
            <Alert>
              <MapPin className="h-4 w-4" />
              <AlertDescription>Please select a community to view available buildings.</AlertDescription>
            </Alert>
          )}

          {/* No Building Selected */}
          {selectedCommunity && !selectedBuilding && !isLoadingAssets && (
            <Alert>
              <Building2 className="h-4 w-4" />
              <AlertDescription>Please select a building to view its assets.</AlertDescription>
            </Alert>
          )}

          {/* No Assets Found */}
          {selectedBuilding && !isLoadingAssets && !assetData && (
            <Alert>
              <Package className="h-4 w-4" />
              <AlertDescription>No assets found for the selected building.</AlertDescription>
            </Alert>
          )}

          {/* Asset Data Display */}
          {assetData && !isLoadingAssets && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
                    <Package className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {buildingTotalCount !== null 
                        ? buildingTotalCount 
                        : assetData.totalAssets || 0}
                    </div>
                    {buildingTotalCount !== null && buildingTotalCount !== assetData.totalAssets && (
                      <p className="text-xs text-muted-foreground mt-1">
                        From building summary (BOQ)
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Categories</CardTitle>
                    <Filter className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{assetData.categoriesFound?.length || 0}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Community</CardTitle>
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm font-bold truncate">{selectedCommunityData?.communityName}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Building</CardTitle>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm font-bold truncate">{assetData.buildingName}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Filters and Search */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Filters & Search
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div>
                      <Label htmlFor="search">Search Assets</Label>
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="search"
                          placeholder="Search by name, ID, or subcategory..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Category</Label>
                      <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {assetData.categoriesFound?.map((category) => (
                            <SelectItem key={category} value={category}>
                              {assetData.categories[category]?.categoryInfo?.name || category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Sub Category</Label>
                      <Select value={selectedSubCategory} onValueChange={setSelectedSubCategory}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Sub Categories</SelectItem>
                          {subCategories.map((subCategory) => (
                            <SelectItem key={subCategory} value={subCategory}>
                              {subCategory}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-end">
                      <Button onClick={exportAssets} variant="outline" className="w-full bg-transparent">
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-muted-foreground">
                    Showing {filteredAssets.length} of {assetData.totalAssets} assets
                  </div>
                </CardContent>
              </Card>

              {/* 3D Coordinates Upload */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    Upload 3D Coordinates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <Label htmlFor="coordinate-file" className="text-sm font-medium">
                          Upload Excel File
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1 mb-2">
                          Excel file should contain columns: GlobalId, FA_Device_Address, X, Y, Z
                        </p>
                        <div className="flex gap-2">
                          <Input
                            id="coordinate-file"
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleCoordinateFileUpload}
                            disabled={isUploadingCoordinates || !selectedBuilding || boqAssets.length === 0}
                            className="flex-1"
                          />
                          {isUploadingCoordinates && (
                            <Button disabled variant="outline">
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Processing...
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {isUploadingCoordinates && uploadProgress.total > 0 && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Processing assets...</span>
                          <span className="font-medium">
                            {uploadProgress.current} / {uploadProgress.total}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 inline mr-1" />
                          Matched {uploadProgress.matched} assets by device address
                        </p>
                      </div>
                    )}

                    {!selectedBuilding && (
                      <Alert>
                        <Building2 className="h-4 w-4" />
                        <AlertDescription>
                          Please select a building first to upload coordinates
                        </AlertDescription>
                      </Alert>
                    )}

                    {selectedBuilding && boqAssets.length === 0 && !isLoadingBoq && (
                      <Alert>
                        <Package className="h-4 w-4" />
                        <AlertDescription>
                          No BOQ assets found. Please ensure assets are loaded for this building.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Assets Table - BOQ Details */}
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Package className="h-5 w-5" />
                      Assets Table (BOQ Details)
                    </CardTitle>
                    {boqAssets.length > 0 && (
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by device address..."
                          value={boqDeviceAddressSearch}
                          onChange={(e) => setBoqDeviceAddressSearch(e.target.value)}
                          className="pl-8 h-9"
                        />
                      </div>
                    )}
                  </div>
                  {boqAssets.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedRowKeys.length > 0 && (
                        <>
                          <span className="text-sm text-muted-foreground whitespace-nowrap">
                            {selectedRowKeys.length} selected
                          </span>
                          <Button type="button" variant="outline" size="sm" onClick={() => setSelectedRowKeys([])}>
                            Clear selection
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={isBulkDeleting}
                            onClick={handleBulkDeleteBuildingAssets}
                          >
                            {isBulkDeleting ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Deleting…
                              </>
                            ) : (
                              <>
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete selected
                              </>
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {boqAssets.length > 0 && boqDeviceAddressSearch.trim() && (
                    <p className="text-sm text-muted-foreground mb-3">
                      Showing {filteredBoqAssets.length} of {boqAssets.length} assets
                    </p>
                  )}
                  {isLoadingBoq ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" />
                      <span>Loading BOQ assets...</span>
                    </div>
                  ) : (
                    <div className="border rounded-md max-h-[600px] overflow-auto">
                      <table className="w-full caption-bottom text-sm">
                        <TableHeader>
                          <TableRow className="border-b-0 hover:bg-transparent data-[state=selected]:bg-transparent">
                            <TableHead
                              className="sticky top-0 z-20 border-b bg-background px-2 py-2 w-10 text-sm font-medium whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                id="boq-select-all"
                                checked={
                                  filteredBoqAssets.length > 0 &&
                                  filteredBoqAssets.every((a) =>
                                    selectedRowKeys.includes(assetRowKey(a)),
                                  )
                                }
                                onCheckedChange={(c) => toggleSelectAllBoq(!!c)}
                                disabled={filteredBoqAssets.length === 0 || isBulkDeleting}
                              />
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Building Asset ID
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Asset Name
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Device Location
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Device Address
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Main Category
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Model
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              X
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Y
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Z
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Global ID
                            </TableHead>
                            <TableHead className="sticky top-0 z-20 border-b bg-background px-2 py-2 text-sm font-medium whitespace-nowrap">
                              Status
                            </TableHead>
                            <TableHead
                              className="sticky top-0 z-20 border-b bg-background px-2 py-2 w-12 text-sm font-medium text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {boqAssets.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                                No BOQ assets found
                              </TableCell>
                            </TableRow>
                          ) : filteredBoqAssets.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                                No assets match device address &quot;{boqDeviceAddressSearch.trim()}&quot;
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredBoqAssets.map((asset) => (
                              <TableRow
                                key={assetRowKey(asset)}
                                className="cursor-pointer hover:bg-muted/60"
                                onClick={() => {
                                  const buildingAssetID = asset.buildingAssetId || asset.id
                                  if (!buildingAssetID || !asset.categoryKey || !selectedBuildingDbName) return
                                  const params = new URLSearchParams({
                                    building: selectedBuildingDbName,
                                    categoryKey: asset.categoryKey,
                                    buildingAssetID: buildingAssetID,
                                  })
                                  router.push(`/dashboard/assets/view/details?${params.toString()}`)
                                }}
                              >
                                <TableCell
                                  className="px-2 py-2 w-10 align-middle"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Checkbox
                                    id={`boq-row-${assetRowKey(asset)}`}
                                    checked={selectedRowKeys.includes(assetRowKey(asset))}
                                    onCheckedChange={(c) => toggleRowSelected(asset, !!c)}
                                    disabled={isBulkDeleting}
                                  />
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[150px] truncate" title={asset.buildingAssetId || asset.id}>
                                  {asset.buildingAssetId || asset.id || "-"}
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[160px] truncate" title={asset.assetName || ""}>
                                  {asset.assetName || "-"}
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[160px] truncate" title={asset.deviceLocation || ""}>
                                  {asset.deviceLocation || "-"}
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[140px] truncate" title={asset.deviceAddress || ""}>
                                  {asset.deviceAddress || "-"}
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[120px] truncate" title={asset.mainCategory || ""}>
                                  {asset.mainCategory || "-"}
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[120px] truncate" title={asset.partModelNumber || ""}>
                                  {asset.partModelNumber || "-"}
                                </TableCell>
                                <TableCell className="px-2 py-2 whitespace-nowrap">
                                  {asset.coordinates?.x !== undefined ? (
                                    <span className="text-green-600 font-mono text-xs">
                                      {asset.coordinates.x.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="px-2 py-2 whitespace-nowrap">
                                  {asset.coordinates?.y !== undefined ? (
                                    <span className="text-green-600 font-mono text-xs">
                                      {asset.coordinates.y.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="px-2 py-2 whitespace-nowrap">
                                  {asset.coordinates?.z !== undefined ? (
                                    <span className="text-green-600 font-mono text-xs">
                                      {asset.coordinates.z.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="px-2 py-2 max-w-[120px] truncate" title={asset.globalId || ""}>
                                  {asset.globalId ? (
                                    <span className="text-blue-600 font-mono text-xs">{asset.globalId}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="px-2 py-2 whitespace-nowrap">
                                  <Badge variant={asset.status === "Active" ? "default" : "secondary"}>
                                    {asset.status || "Active"}
                                  </Badge>
                                </TableCell>
                                <TableCell
                                  className="px-2 py-2 text-right align-middle"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    title="Delete asset"
                                    disabled={isBulkDeleting || deletingRowKey === assetRowKey(asset)}
                                    onClick={(e) => handleDeleteBuildingAsset(asset, e)}
                                  >
                                    {deletingRowKey === assetRowKey(asset) ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
