"use client"

import { useState, useEffect, use } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Building2,
  Package,
  ArrowRight,
  CheckCircle,
  Loader2,
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
  MapPin,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import secureLocalStorage from "react-secure-storage"
import { db } from "@/config/firebase"
import { collection, doc, getDoc, getDocs, writeBatch,where,query } from "firebase/firestore"
import dynamic from "next/dynamic"
import { useAppData } from "@/hooks/useAppData"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"

// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />, // Placeholder with same dimensions
  },
)

export default function AssetTransferPage() {
  const [mounted, setMounted] = useState(false)
  const { communities, isLoadingCommunities, isReady } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [buildings, setBuildings] = useState([])
  const [assets, setAssets] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCommunity, setSelectedCommunity] = useState("")
  const [selectedBuilding, setSelectedBuilding] = useState("")
  const [selectedAsset, setSelectedAsset] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("")
  const [selectedAssetCategory, setSelectedAssetCategory] = useState("")
  const [isLoadingAssets, setIsLoadingAssets] = useState(false)
  const [isLoadingCategories, setIsLoadingCategories] = useState(false)
  const [isTransferring, setIsTransferring] = useState(false)
  const [transferSuccess, setTransferSuccess] = useState(false)
  const [uploadedAssets, setUploadedAssets] = useState([])
  const [isLoadingUploadedAssets, setIsLoadingUploadedAssets] = useState(false)
  const [selectedUploadedAsset, setSelectedUploadedAsset] = useState(null)
  const { toast} = useToast()

  // Display label for the asset select (BOQ template name, not internal group communityId)
  const getAssetGroupLabel = (data = {}, fallbackId = "") => {
    const deviceType = String(data?.deviceType || "").trim()
    const assetName = String(data?.assetName || data?.originalAssetId || "").trim()
    if (deviceType) return deviceType
    if (assetName) return assetName
    const communityId = String(data?.communityId || "").trim()
    if (communityId.startsWith("asset-group_")) {
      const suffix = communityId.replace(/^asset-group_[^_]+_/, "")
      if (suffix) return suffix.replace(/_/g, " ")
    }
    if (communityId) return communityId
    return String(fallbackId || "").trim()
  }

  const getAssetGroupId = (data = {}, fallbackId = "") => {
    const deviceType = String(data?.deviceType || "").trim()
    if (deviceType) return `deviceType:${deviceType}`
    const communityId = String(data?.communityId || "").trim()
    if (communityId) return `communityId:${communityId}`
    const name = String(data?.assetName || data?.originalAssetId || fallbackId || "").trim()
    return `assetName:${name}`
  }


  // 11 Asset Categories with icons and colors
  const assetCategories = [
    {
      value: "fire-life-safety",
      label: "Fire & Life Safety Systems (FLS)",
      icon: Flame,
      color: "bg-red-500",
      description: "Fire alarms, sprinklers, emergency systems",
    },
    {
      value: "electrical",
      label: "Electrical Systems",
      icon: Zap,
      color: "bg-yellow-500",
      description: "Power distribution, panels, transformers",
    },
    {
      value: "hvac",
      label: "HVAC Systems",
      icon: Wind,
      color: "bg-blue-500",
      description: "Heating, ventilation, air conditioning",
    },
    {
      value: "plumbing",
      label: "Plumbing & Drainage Systems",
      icon: Droplets,
      color: "bg-cyan-500",
      description: "Water systems, pipes, pumps, tanks",
    },
    {
      value: "elv",
      label: "ELV (Extra-Low Voltage) Systems",
      icon: Cable,
      color: "bg-purple-500",
      description: "Communication, data, network systems",
    },
    {
      value: "security",
      label: "Security Systems",
      icon: Shield,
      color: "bg-gray-700",
      description: "Access control, CCTV, surveillance",
    },
    {
      value: "vertical-transport",
      label: "Vertical Transportation",
      icon: MoveVertical,
      color: "bg-indigo-500",
      description: "Elevators, lifts, escalators",
    },
    {
      value: "lighting",
      label: "Lighting Systems",
      icon: Lightbulb,
      color: "bg-amber-500",
      description: "LED, lamps, fixtures, illumination",
    },
    {
      value: "bms",
      label: "Building Management & Automation (BMS/IBMS)",
      icon: Brain,
      color: "bg-emerald-500",
      description: "Automation, control, monitoring systems",
    },
    {
      value: "landscaping",
      label: "Landscaping & Irrigation",
      icon: Trees,
      color: "bg-green-600",
      description: "Gardens, irrigation, landscape systems",
    },
    {
      value: "additional",
      label: "Optional Additional Asset Groups",
      icon: Archive,
      color: "bg-slate-500",
      description: "Miscellaneous and other assets",
    },
  ]

  // Add this useEffect to handle mounting
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isReady || communities.length === 0 || selectedCommunity) return
    const first = communities[0]
    if (first?.id) setSelectedCommunity(first.id)
  }, [isReady, communities, selectedCommunity])

  // Fetch buildings when community is selected
  useEffect(() => {
    if (selectedCommunity) {
      const community = communities.find((c) => c.id === selectedCommunity)
      if (community) {
        setBuildings(community.buildings || [])
      }
    } else {
      setBuildings([])
      setSelectedBuilding("")
    }
  }, [selectedCommunity, communities])

  // Fetch assets when building is selected
  useEffect(() => {
    if (selectedBuilding) {
      fetchAssets()
    } else {
      setAssets([])
      setSelectedAsset("")
    }
  }, [selectedBuilding])

  // Fetch categories when asset is selected
  useEffect(() => {
    if (selectedAsset) {
      fetchCategories()
    } else {
      setCategories([])
      setSelectedCategory("")
    }
  }, [selectedAsset])

  // Auto-select first category when categories are loaded
  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      setSelectedCategory(categories[0])
    }
  }, [categories])

  // Reset transfer success when selections change
  useEffect(() => {
    setTransferSuccess(false)
  }, [selectedCommunity, selectedBuilding, selectedAsset, selectedCategory, selectedAssetCategory])

  // Fetch uploaded assets when asset category is selected
  useEffect(() => {
    if (selectedAssetCategory) {
      fetchUploadedAssets()
    } else {
      setUploadedAssets([])
    }
    // Clear selected uploaded asset when category changes
    setSelectedUploadedAsset(null)
  }, [selectedAssetCategory])

  useEffect(() => { 
    setSelectedAssetCategory('')
  }, [selectedCategory])

  const fetchAssets = async () => {
    setIsLoadingAssets(true)
    try {
      if (!selectedBuilding) {
        setAssets([])
        return
      }

      console.log(`🔍 Fetching assets for building: ${selectedBuilding}`)

      // Fetch assets from all category collections under ${buildingName}/asset/*
      // The 11 asset categories
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "security",
        "lighting",
        "it-networking",
        "structural",
        "landscaping",
        "additional",
        "mechanical",
      ]

      const assetMap = new Map()
      let totalAssetsFound = 0

      // Query each category collection
      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(db, selectedBuilding+"BuildingDB", "asset", categoryKey)
          const categorySnapshot = await getDocs(categoryCollection)

          if (categorySnapshot.size > 0) {
            console.log(`✓ Found ${categorySnapshot.size} assets in ${categoryKey} category`)
          }

          categorySnapshot.forEach((docSnap) => {
            const data = docSnap.data() || {}
            const groupLabel = getAssetGroupLabel(data, docSnap.id)
            const groupId = getAssetGroupId(data, docSnap.id)
            if (!groupLabel || !groupId) return

            // Skip assets that have already been transferred
            if (data.transferredAt) {
              console.log(`⏭ Skipping transferred asset group item: ${groupLabel}`)
              return
            }

            totalAssetsFound++

            // Store unique asset names with count
            if (!assetMap.has(groupId)) {
              assetMap.set(groupId, {
                id: groupId,
                name: groupLabel,
                assetName: String(data?.assetName || "").trim(),
                count: 1,
                category: categoryKey,
              })
            } else {
              // Increment count for same grouped key
              const existing = assetMap.get(groupId)
              existing.count++
              if (!existing.assetName && data?.assetName) {
                existing.assetName = String(data.assetName).trim()
              }
              if (
                groupLabel &&
                (!existing.name || existing.name.startsWith("asset-group_"))
              ) {
                existing.name = groupLabel
              }
            }
          })
        } catch (error) {
          // Category collection might not exist, continue to next
          console.warn(`⚠ Category ${categoryKey} not found or error:`, error.message)
        }
      }

      const uniqueAssets = Array.from(assetMap.values()).sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      )
      console.log(`📦 Total: ${totalAssetsFound} asset instances, ${uniqueAssets.length} unique asset types`)
      
      setAssets(uniqueAssets)

      if (uniqueAssets.length === 0) {
        toast({
          title: "No Assets Found",
          description: `No assets found in ${selectedBuilding}. Create assets first using the Create Assets page.`,
          variant: "default",
        })
      }
    } catch (error) {
      console.error("❌ Error fetching assets:", error)
      toast({
        title: "Error",
        description: "Failed to fetch assets for this building",
        variant: "destructive",
      })
    } finally {
      setIsLoadingAssets(false)
    }
  }

  const fetchCategories = async () => {
    setIsLoadingCategories(true)
    try {
      if (!selectedAsset || !selectedBuilding) {
        setCategories([])
        return
      }

      // Fetch categories from all asset documents that match the selected asset name
      // The 11 asset categories
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "security",
        "lighting",
        "it-networking",
        "structural",
        "landscaping",
        "additional",
        "mechanical",
      ]

      const categoriesSet = new Set()

      // Query each category collection to find assets matching the selected asset name
      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(db, selectedBuilding+"BuildingDB", "asset", categoryKey)
          const categorySnapshot = await getDocs(categoryCollection)

          categorySnapshot.forEach((docSnap) => {
            const data = docSnap.data() || {}
            const groupedId = getAssetGroupId(data, docSnap.id)

            // Skip assets that have already been transferred
            if (data.transferredAt) {
              return
            }

            // Check if this document matches the selected asset
            if (groupedId === selectedAsset) {
              // Get the mainCategory (subcategory) from the asset document
              const mainCategory = data.mainCategory
              if (mainCategory && mainCategory !== "Unknown Category") {
                categoriesSet.add(mainCategory)
              }
            }
          })
        } catch (error) {
          // Category collection might not exist, continue to next
          console.warn(`Category ${categoryKey} not found or error:`, error)
        }
      }

      if (categoriesSet.size === 0) {
        setCategories([])
        return
      }

      setCategories(Array.from(categoriesSet))
    } catch (error) {
      console.error("Error fetching categories:", error)
      toast({
        title: "Error",
        description: "Failed to fetch asset categories",
        variant: "destructive",
      })
    } finally {
      setIsLoadingCategories(false)
    }
  }

  const fetchUploadedAssets = async () => {
    setIsLoadingUploadedAssets(true)
    try {
           console.log(`🔍 Fetching uploaded assets from AssetsList collection`)

      // Fetch all assets from AssetsList collection if selectedCategory and selectedAssetCategory are empty
      // else fetch documents with system === selectedCategory and category === selectedAssetCategory using Firestore where
      let assetsList = []
      let assetsSnapshot
      const assetsListCollection = collection(db, "AssetsList")
      if (!selectedCategory && !selectedAssetCategory) {
        // No filters, fetch all
        assetsSnapshot = await getDocs(assetsListCollection)
      } else {
        // Build Firestore query with where
        let q = assetsListCollection
        console.log({selectedAssetCategory})
        const filters = []
        if (selectedCategory) {
          let categoryFilter = selectedCategory.includes(" SYSTEM") ? selectedCategory.replace(" SYSTEM", "") : selectedCategory
        console.log({categoryFilter})

          filters.push(where("system", "==", categoryFilter))
        }
        if (selectedAssetCategory) {
          let assetCategoryFilter = selectedAssetCategory === "fire-life-safety" ? "FIRE AND LIFE SAFETY" : selectedAssetCategory
          filters.push(where("category", "==", assetCategoryFilter))
        }
        if (filters.length > 0) {
          q = query(assetsListCollection, ...filters)
        }
        assetsSnapshot = await getDocs(q)
      }

      assetsSnapshot.forEach((docSnap) => {
        const data = docSnap.data()
        assetsList.push({
          id: docSnap.id,
          ...data,
        })
      })

      // Sort by creation date (newest first)
      assetsList.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0)
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0)
        return dateB - dateA
      })

      console.log(`✓ Found ${assetsList.length} assets in AssetsList collection`)
      setUploadedAssets(assetsList)
      console.log({assetsList})
    } catch (error) {
      console.error("❌ Error fetching uploaded assets:", error)
      toast({
        title: "Error",
        description: "Failed to fetch uploaded assets from AssetsList",
        variant: "destructive",
      })
      setUploadedAssets([])
    } finally {
      setIsLoadingUploadedAssets(false)
    }
  }

  // console.log({selectedCategory})
  // console.log({selectedAssetCategory})

  const handleTransfer = async () => {
    console.log("🔍 Transfer button clicked - Checking selections:")
    console.log("  - Community:", selectedCommunity)
    console.log("  - Building:", selectedBuilding)
    console.log("  - Asset:", selectedAsset)
    console.log("  - Category:", selectedCategory)
    console.log("  - Asset Category:", selectedAssetCategory)
    console.log("  - Uploaded Asset:", selectedUploadedAsset?.assetId || "None")

    if (!selectedCommunity || !selectedBuilding || !selectedAsset || !selectedCategory || !selectedAssetCategory) {
      const missing = []
      if (!selectedCommunity) missing.push("Community")
      if (!selectedBuilding) missing.push("Building")
      if (!selectedAsset) missing.push("Asset Name")
      if (!selectedCategory) missing.push("Asset Category")
      if (!selectedAssetCategory) missing.push("Target Category")
      
      toast({
        title: "Missing Information",
        description: `Please select: ${missing.join(", ")}`,
        variant: "destructive",
      })
      return
    }

    setIsTransferring(true)
    setTransferSuccess(false)

    try {
      // Helper to sanitise document IDs (mirrors backend logic)
      const sanitizeDocumentId = (id) => {
        return id
          .replace(/[\/\\]/g, "_")
          .replace(/[()]/g, "")
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .substring(0, 100)
      }

      // 1. Find source asset documents from all category collections
      // The 11 asset categories
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "security",
        "lighting",
        "it-networking",
        "structural",
        "landscaping",
        "additional",
        "mechanical",
      ]

      const sourceAssets = []
      let sourceCategoryKey = null

      // Find all asset documents matching selectedAsset and selectedCategory
      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(db, selectedBuilding+"BuildingDB", "asset", categoryKey)
          const categorySnapshot = await getDocs(categoryCollection)

          categorySnapshot.forEach((docSnap) => {
            const data = docSnap.data() || {}
            const groupedId = getAssetGroupId(data, docSnap.id)
            const mainCategory = data.mainCategory

            // Check if this document matches the selected asset and category
            if (groupedId === selectedAsset && mainCategory === selectedCategory) {
              sourceAssets.push({
                id: docSnap.id,
                data: data,
              })
              if (!sourceCategoryKey) {
                sourceCategoryKey = categoryKey
              }
            }
          })
        } catch (error) {
          // Category collection might not exist, continue to next
          console.warn(`Category ${categoryKey} not found or error:`, error)
        }
      }

      if (sourceAssets.length === 0) {
        throw new Error(`No assets found matching "${selectedAsset}" with category "${selectedCategory}"`)
      }

      // 2. Prepare destination collection path (building/asset/category)
      const destinationPath = `${selectedBuilding}BuildingDB/asset/${selectedAssetCategory}`
      const destinationCollection = collection(db, destinationPath)

      // 3. Prepare batch write
      const batch = writeBatch(db)
      let transferredAssets = 0

      // 4. Prepare uploaded asset details to merge (if selected).
      // Keep all meaningful metadata (documents, price, brand/spec fields, etc.) from the selected uploaded asset.
      const uploadedAssetDetails = selectedUploadedAsset
        ? Object.entries(selectedUploadedAsset).reduce((acc, [key, value]) => {
            // Skip Firestore doc metadata keys that should not be copied into building assets.
            if (["id", "createdAt", "updatedAt", "rowNumber"].includes(key)) {
              return acc
            }

            // Preserve arrays/objects (e.g., documents) as-is.
            if (Array.isArray(value) || (value && typeof value === "object")) {
              acc[key] = value
              return acc
            }

            // Copy scalar values when present.
            if (value !== undefined && value !== null && value !== "") {
              acc[key] = value
            }
            return acc
          }, {})
        : {}

      // Ensure canonical fallback keys are always populated when possible.
      if (selectedUploadedAsset) {
        uploadedAssetDetails.customImageUrl =
          uploadedAssetDetails.customImageUrl ||
          selectedUploadedAsset.customImageUrl ||
          selectedUploadedAsset.assetImageUrl ||
          ""
        uploadedAssetDetails.uploadedAssetId =
          uploadedAssetDetails.uploadedAssetId ||
          selectedUploadedAsset.assetId ||
          selectedUploadedAsset.id ||
          ""
        uploadedAssetDetails.partModelNumber =
          uploadedAssetDetails.partModelNumber ||
          selectedUploadedAsset.partModelNumber ||
          selectedUploadedAsset.model ||
          selectedUploadedAsset.partNumber ||
          ""
      }

      const selectedAssetDisplayName =
        assets.find((a) => a.id === selectedAsset)?.name ||
        assets.find((a) => a.id === selectedAsset)?.assetName ||
        selectedAsset

      // 5. Transfer each source asset to the destination collection
      sourceAssets.forEach((sourceAsset) => {
        const sanitizedAssetId = sanitizeDocumentId(sourceAsset.id)
        const destDocRef = doc(destinationCollection, sanitizedAssetId)

        const now = new Date()

        const documentData = {
          ...sourceAsset.data,
          ...uploadedAssetDetails, // Merge uploaded asset details
          buildingName: selectedBuilding,
          assetName:
            sourceAsset.data?.assetName ||
            selectedAssetDisplayName,
          assetCategory: selectedAssetCategory,
          mainCategory: selectedCategory,
          sourceDocument: `${selectedBuilding}/asset/${sourceCategoryKey}/${sourceAsset.id}`,
          transferredAt: now,
          updatedAt: now,
          deviceLocation: "",
          deviceAddress: "",
        }

        batch.set(destDocRef, documentData)
        transferredAssets += 1
      })

      // 5. Update / create buildingSummaries/{buildingName}
      const summaryRef = doc(db,selectedBuilding+"BuildingDB" ,"buildingSummary")
      const summarySnap = await getDoc(summaryRef)

      if (summarySnap.exists()) {
        const currentData = summarySnap.data() || {}
        
        // Handle categories - could be array or object from create assets page
        let existingCategories = []
        if (Array.isArray(currentData.categories)) {
          existingCategories = currentData.categories
        } else if (typeof currentData.categories === 'object' && currentData.categories !== null) {
          // If it's an object (e.g., {FIRE ALARM: 5}), get the keys as categories
          existingCategories = Object.keys(currentData.categories)
        }
        
        const updatedCategories = Array.from(new Set([...existingCategories, selectedAssetCategory]))

        batch.update(summaryRef, {
          totalAssets: (currentData.totalAssets || currentData.totalAssetsCount || 0) + transferredAssets,
          categories: updatedCategories,
          lastTransferAt: new Date(),
          [`structure.${selectedAssetCategory}.transferredFrom`]: `${selectedBuilding}/asset/${sourceCategoryKey}/${selectedCategory}`,
        })
      } else {
        batch.set(summaryRef, {
          buildingName: selectedBuilding,
          totalAssets: transferredAssets,
          categories: [selectedAssetCategory],
          lastTransferAt: new Date(),
          structure: {
            [selectedAssetCategory]: {
              transferredFrom: `${selectedBuilding}/asset/${sourceCategoryKey}/${selectedCategory}`,
            },
          },
        })
      }

      // 6. Commit batch
      await batch.commit()

      console.log(`✅ Transfer complete: ${transferredAssets} assets transferred${selectedUploadedAsset ? ' with enriched details' : ''}`)

      setTransferSuccess(true)
      // Remove the transferred category from the categories list
      setCategories((prevCategories) => prevCategories.filter((category) => category !== selectedCategory))
      // Clear the selected category since it's been transferred
      setSelectedCategory("")
      // Clear the selected uploaded asset
      setSelectedUploadedAsset(null)

      toast({
        title: "Transfer Successful",
        description: `Successfully transferred ${transferredAssets} assets from "${selectedCategory}" to ${destinationPath}${selectedUploadedAsset ? ' with enriched asset details from upload' : ''}`,
      })
    } catch (error) {
      console.error("Error transferring assets:", error)
      toast({
        title: "Transfer Failed",
        description: error.message || "Failed to transfer assets",
        variant: "destructive",
      })
    } finally {
      setIsTransferring(false)
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-8">
            <SidebarTrigger className="-ml-1" />
            <ClientModeToggle />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard">Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Asset Transfer</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <PageHelpBanner />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">Asset Transfer<FaqHelpButton articleId="page-map-assets" size="md" /></h1>
            <p className="text-muted-foreground">
              Transfer assets from the asset collection to specific building categories
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Selection Panel */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Asset Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Community Selection */}
                <div className="space-y-2">
                  <Label htmlFor="community-select" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Community
                  </Label>
                  <Select value={selectedCommunity} onValueChange={setSelectedCommunity} disabled={isLoadingCommunities}>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingCommunities ? "Loading communities..." : "Select a community"} />
                    </SelectTrigger>
                    <SelectContent>
                      {communities.map((community) => (
                        <SelectItem key={community.id} value={community.id}>
                          <div className="flex flex-col">
                            <span>{community.communityName}</span>
                            <span className="text-xs text-muted-foreground">
                              {community.totalBuildings} buildings
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Building Selection */}
                <div className="space-y-2">
                  <Label htmlFor="building-select" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Building
                  </Label>
                  <Select value={selectedBuilding} onValueChange={setSelectedBuilding} disabled={!selectedCommunity}>
                    <SelectTrigger>
                      <SelectValue placeholder={!selectedCommunity ? "Select a community first" : "Select a building"} />
                    </SelectTrigger>
                    <SelectContent>
                      {buildings.map((building) => (
                        <SelectItem key={building} value={building}>
                          {building}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Asset Selection */}
                <div className="space-y-2">
                  <Label htmlFor="asset-select">Asset Name</Label>
                  <Select
                    value={selectedAsset}
                    onValueChange={setSelectedAsset}
                    disabled={!selectedBuilding || isLoadingAssets}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !selectedBuilding
                            ? "Select a building first"
                            : isLoadingAssets
                              ? "Loading assets..."
                              : assets.length === 0
                                ? "No assets found - Create assets first"
                                : "Select an asset"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {assets.length > 0 ? (
                        assets.map((asset) => (
                          <SelectItem key={asset.id} value={asset.id}>
                            <div className="flex items-center justify-between w-full gap-2">
                              <span className="truncate">{asset.name}</span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                ({asset.count} {asset.count === 1 ? 'instance' : 'instances'})
                              </span>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-assets" disabled>
                          No assets available - Create assets first
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {assets.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {assets.length} unique asset {assets.length === 1 ? 'type' : 'types'} available from Create Assets page
                    </p>
                  )}
                </div>

                {/* Category Selection */}
                <div className="space-y-2">
                  <Label>Asset Category</Label>
                  {isLoadingCategories ? (
                    <div className="flex items-center gap-2 p-3 border rounded-md">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading categories...</span>
                    </div>
                  ) : categories.length > 0 ? (
                    <div className="grid gap-2">
                      {categories.map((category) => (
                        <div
                          key={category}
                          className={`p-3 border rounded-md cursor-pointer transition-colors ${
                            selectedCategory === category
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => setSelectedCategory(category)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{category}</span>
                            {selectedCategory === category && <CheckCircle className="h-4 w-4 text-primary" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : selectedAsset ? (
                    <div className="p-3 border rounded-md text-center text-muted-foreground">
                      No categories found for this asset
                    </div>
                  ) : (
                    <div className="p-3 border rounded-md text-center text-muted-foreground">
                      Select an asset to view categories
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Asset Category & Transfer Panel */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowRight className="h-5 w-5" />
                  Transfer Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Asset Category Selection */}
                <div className="space-y-3">
                  <Label>Target Asset Category</Label>
                  <div className="grid gap-3 max-h-96 overflow-y-auto">
                    {assetCategories.map((category) => {
                      const Icon = category.icon
                      return (
                        <div
                          key={category.value}
                          className={`p-4 border rounded-lg cursor-pointer transition-all ${
                            selectedAssetCategory === category.value
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => setSelectedAssetCategory(category.value)}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-md ${category.color} text-white flex-shrink-0`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm leading-tight">{category.label}</div>
                              <div className="text-xs text-muted-foreground mt-1">{category.description}</div>
                            </div>
                            {selectedAssetCategory === category.value && (
                              <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Transfer Summary */}
                {selectedCommunity && selectedBuilding && selectedAsset && selectedCategory && selectedAssetCategory && (
                  <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                    <h4 className="font-medium">Transfer Summary</h4>
                    <div className="space-y-1 text-sm">
                      <div>
                        <strong>Community:</strong> {communities.find(c => c.id === selectedCommunity)?.communityName}
                      </div>
                      <div>
                        <strong>From:</strong>{" "}
                        {assets.find((asset) => (asset.id || asset.name || asset) === selectedAsset)?.name ||
                          assets.find((asset) => (asset.id || asset.name || asset) === selectedAsset)?.id ||
                          selectedAsset}{" "}
                        → {selectedCategory}
                      </div>
                      <div>
                        <strong>To:</strong> {selectedBuilding}/asset/{selectedAssetCategory}
                      </div>
                      <div>
                        <strong>Category:</strong>{" "}
                        {assetCategories.find((cat) => cat.value === selectedAssetCategory)?.label}
                      </div>
                      {selectedUploadedAsset && (
                        <div className="mt-2 pt-2 border-t">
                          <strong>Asset Details from Upload:</strong>
                          <div className="ml-4 mt-1 space-y-0.5 text-xs">
                            {selectedUploadedAsset.assetId && (
                              <div>Asset ID: {selectedUploadedAsset.assetId}</div>
                            )}
                            {selectedUploadedAsset.brand && (
                              <div>Brand: {selectedUploadedAsset.brand}</div>
                            )}
                            {selectedUploadedAsset.manufacturer && (
                              <div>Manufacturer: {selectedUploadedAsset.manufacturer}</div>
                            )}
                            {selectedUploadedAsset.model && (
                              <div>Model: {selectedUploadedAsset.model}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {transferSuccess && (
                  <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-600 dark:text-green-400">Transfer Complete</AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                      The category has been successfully transferred to the{" "}
                      {assetCategories.find((cat) => cat.value === selectedAssetCategory)?.label} section in{" "}
                      {selectedBuilding}. You can now select another category to transfer.
                    </AlertDescription>
                  </Alert>
                 )}
               </CardContent>
             </Card>

             {/* Uploaded Assets from Upload Assets Page */}
             <Card className="shadow-md">
               <CardHeader>
                 <CardTitle className="flex items-center gap-2">
                   <Package className="h-5 w-5" />
                   Available Assets from Upload
                   {selectedAssetCategory && assetCategories.find((cat) => cat.value === selectedAssetCategory) && (
                     <span className="text-sm font-normal text-muted-foreground">
                       - {assetCategories.find((cat) => cat.value === selectedAssetCategory)?.label}
                     </span>
                   )}
                 </CardTitle>
                 <p className="text-sm text-muted-foreground">
                   Assets uploaded via the Upload Assets page. Click to select asset details to merge with transferred assets.
                 </p>
               </CardHeader>
               <CardContent>
                 {!selectedAssetCategory ? (
                   <div className="text-center py-8 text-muted-foreground">
                     <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                     <p className="font-medium">Select a Target Category</p>
                     <p className="text-sm mt-1">
                       Choose a target asset category to view available uploaded assets
                     </p>
                   </div>
                 ) : isLoadingUploadedAssets ? (
                   <div className="flex items-center justify-center p-8">
                     <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                     <span className="ml-2 text-muted-foreground">Loading assets...</span>
                   </div>
                ) : uploadedAssets.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {uploadedAssets.length} assets available
                      </span>
                      {selectedUploadedAsset && (
                        <span className="text-xs text-primary font-medium">1 selected</span>
                      )}
                    </div>
                    <div className="grid gap-3 max-h-[500px] overflow-y-auto">
                      {uploadedAssets
                        .map((asset) => (
                          <div
                            key={asset.id}
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${
                              selectedUploadedAsset?.id === asset.id
                                ? "border-primary bg-primary/5 shadow-sm"
                                : "border-border hover:border-primary/50"
                            }`}
                            onClick={() => setSelectedUploadedAsset(asset)}
                          >
                            <div className="flex items-start gap-3">
                              {asset.customImageUrl ? (
                                <img
                                  src={asset.customImageUrl}
                                  alt={asset.assetId || "Asset"}
                                  className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                                  onError={(e) => {
                                    // Hide image and show placeholder on error
                                    const img = e.target
                                    const placeholder = img.nextElementSibling
                                    if (img) img.style.display = "none"
                                    if (placeholder) placeholder.style.display = "flex"
                                  }}
                                />
                              ) : null}
                              <div 
                                className={`w-12 h-12 rounded-md bg-muted flex items-center justify-center flex-shrink-0 ${asset.customImageUrl ? "hidden" : ""}`}
                              >
                                <Package className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-medium text-xs leading-relaxed" title={asset.description || asset.assetId || asset.id}>
                                    {asset.description || asset.assetId || asset.id}
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {asset.system && (
                                      <span className="text-[10px] bg-muted px-2 py-0.5 rounded">
                                        {asset.system}
                                      </span>
                                    )}
                                    {selectedUploadedAsset?.id === asset.id && (
                                      <CheckCircle className="h-4 w-4 text-primary" />
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-0.5 text-xs text-muted-foreground">
                                  {asset.brand && (
                                    <div>
                                      <span className="font-medium">Brand:</span> {asset.brand}
                                    </div>
                                  )}
                                  {asset.partNumber && (
                                    <div>
                                      <span className="font-medium">Part Number:</span> {asset.partNumber}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                    {uploadedAssets.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p className="font-medium">No Assets Match Selected Filters</p>
                        <p className="text-sm mt-1">
                          No assets found for system "{selectedCategory}" and category "{selectedAssetCategory}". Try selecting different filters.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">No Assets Found</p>
                    <p className="text-sm mt-1">
                      Upload assets using the Upload Assets page to see them here
                    </p>
                  </div>
                )}
               </CardContent>
             </Card>
           </div>

           {/* Transfer Asset Button - Bottom Right */}
           <div className="flex flex-col items-end gap-2 mt-6">
             {(!selectedCommunity || !selectedBuilding || !selectedAsset || !selectedCategory || !selectedAssetCategory) && (
               <div className="text-xs text-muted-foreground text-right">
                 {!selectedCommunity && "• Select a community"}{!selectedCommunity && <br />}
                 {!selectedBuilding && "• Select a building"}{!selectedBuilding && <br />}
                 {!selectedAsset && "• Select an asset name"}{!selectedAsset && <br />}
                 {!selectedCategory && "• Select an asset category"}{!selectedCategory && <br />}
                 {!selectedAssetCategory && "• Select a target category"}
               </div>
             )}
             <Button
               onClick={handleTransfer}
               disabled={
                 !selectedCommunity || !selectedBuilding || !selectedAsset || !selectedCategory || !selectedAssetCategory || isTransferring
               }
               size="lg"
               className="min-w-[200px]"
             >
               {isTransferring ? (
                 <>
                   <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                   Transferring...
                 </>
               ) : (
                 <>
                   <ArrowRight className="mr-2 h-4 w-4" />
                   Transfer Asset
                   {selectedUploadedAsset && " (Enriched)"}
                 </>
               )}
             </Button>
           </div>

           {/* Transfer Success Message */}
           {transferSuccess && (
             <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900 mt-4">
               <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
               <AlertTitle className="text-green-600 dark:text-green-400">Transfer Complete</AlertTitle>
               <AlertDescription className="text-green-600 dark:text-green-400">
                 Successfully transferred assets{selectedUploadedAsset ? ' with enriched details' : ''} to the{" "}
                 {assetCategories.find((cat) => cat.value === selectedAssetCategory)?.label} category.
               </AlertDescription>
             </Alert>
           )}
         </div>
       </SidebarInset>
     </SidebarProvider>
   )
 }