"use client"

import { useState, useEffect, useRef } from "react"
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
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Building2,
  Package,
  ArrowRight,
  Loader2,
  Upload,
  ChevronDown,
  ImageIcon,
  MapPin,
  Save,
  X,
  Database,
  Layers,
  Users,
  Smartphone,
  ChevronUp,
  Target,
  Search,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import secureLocalStorage from "react-secure-storage"
import { parseStoredUser } from "@/lib/sessionUser"
import dynamic from "next/dynamic"
import { useAppData } from "@/hooks/useAppData"
import { db, storage } from "@/config/firebase"
import { collection, doc, setDoc, getDocs, updateDoc } from "firebase/firestore"
import {
  buildingsMatch,
  buildFloorMapAssetsListUpdate,
  buildFloorMapPositionPayload,
  getAssetsListIdFromMapping,
  getAssetPlacementLabel,
  matchesAssetAddressSearch,
  hasFloorPosition,
  pickMappingDeviceFields,
  resolveMappingDeviceFields,
} from "@/lib/floorMapAssets"
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import FirestoreService from "@/services/firestoreService"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"
import { CATEGORY_ICONS, getIconForCategory, handleImageError } from "@/lib/assetIcons"

// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

const getAssetIconUrl = (assetName, category, customImageUrl = null) => {
  if (customImageUrl) {
    return customImageUrl
  }
  return getIconForCategory(category)
}

// Utility function to detect mobile devices
const isMobileDevice = () => {
  if (typeof navigator === "undefined") return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

export default function CreateFloorPlanPage() {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Community selection
  const { communities, isLoadingCommunities, isReady } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [selectedCommunity, setSelectedCommunity] = useState("")

  // Building selection (updated to work with communities)
  const [buildings, setBuildings] = useState([])
  const [selectedBuilding, setSelectedBuilding] = useState("")
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false)

  // Asset management - General Assets
  const [generalAssets, setGeneralAssets] = useState([])
  const [availableSystems, setAvailableSystems] = useState([])
  const [selectedSystem, setSelectedSystem] = useState("")
  const [isLoadingGeneralAssets, setIsLoadingGeneralAssets] = useState(false)
  const [generalAssetAddressSearch, setGeneralAssetAddressSearch] = useState("")

  // Asset management - Building Assets
  const [buildingAssets, setBuildingAssets] = useState(null)
  const [isLoadingBuildingAssets, setIsLoadingBuildingAssets] = useState(false)

  // Asset selection mode
  const [assetMode, setAssetMode] = useState("general") // "general" or "building"

  // Floor plan creation
  const [selectedImage, setSelectedImage] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [expandedCategories, setExpandedCategories] = useState(new Set())
  const [availableAssets, setAvailableAssets] = useState([])
  const [selectedAssetForMapping, setSelectedAssetForMapping] = useState("")
  const [selectedAssetDetails, setSelectedAssetDetails] = useState(null)
  const [assetMappings, setAssetMappings] = useState([])
  const [floorPlanName, setFloorPlanName] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [mappingCounter, setMappingCounter] = useState(0)
  const [placedAssetCounts, setPlacedAssetCounts] = useState({})
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })

  // New state for tracking actual image dimensions and position
  const [actualImageDimensions, setActualImageDimensions] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  })

  const imageRef = useRef(null)
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true)
    setIsMobile(isMobileDevice())
  }, [])

  useEffect(() => {
    if (!isReady || communities.length === 0 || selectedCommunity) return
    const first = communities[0]
    if (first?.id) setSelectedCommunity(first.id)
  }, [isReady, communities, selectedCommunity])

  // Reset buildings when community changes
  useEffect(() => {
    if (selectedCommunity) {
      const community = communities.find((c) => c.id === selectedCommunity)
      if (community) {
        setBuildings(community.buildings || [])
        setSelectedBuilding("") // Reset building selection
      }
    } else {
      setBuildings([])
      setSelectedBuilding("")
    }
  }, [selectedCommunity, communities])

  // Reset asset data when switching modes
  useEffect(() => {
    setGeneralAssets([])
    setAvailableSystems([])
    setSelectedSystem("")
    setBuildingAssets(null)
    setAvailableAssets([])
    setSelectedAssetForMapping("")
    setExpandedCategories(new Set())
    setPlacedAssetCounts({})
  }, [assetMode])

  const fetchGeneralAssets = async () => {
    setIsLoadingGeneralAssets(true)
    try {
      const assetsRef = collection(db, "AssetsList")
      const snapshot = await getDocs(assetsRef)
      
      const assets = []
      const systemsSet = new Set()
      
      snapshot.forEach((doc) => {
        const data = doc.data()
        assets.push({
          id: doc.id,
          assetId: data.assetId || "",
          itemType: data.itemType || "",
          category: data.category || "",
          system: data.system || "",
          description: data.description || "",
          customImageUrl: data.customImageUrl || "",
          brand: data.brand || "",
          manufacturer: data.manufacturer || "",
          made: data.made || "",
          ...data
        })
        
        if (data.system) {
          systemsSet.add(data.system)
        }
      })
      
      setGeneralAssets(assets)
      setAvailableSystems(Array.from(systemsSet).sort())
      
      toast({
        title: "Success",
        description: `Loaded ${assets.length} assets from ${systemsSet.size} systems`,
      })
    } catch (error) {
      console.error("Error fetching general assets:", error)
      toast({
        title: "Error",
        description: "Failed to load assets",
        variant: "destructive",
      })
    } finally {
      setIsLoadingGeneralAssets(false)
    }
  }

  const getCategoryKeyForAsset = (categoryName) => {
    const categoryMap = {
      "fire-life-safety": "fire-life-safety",
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
    return categoryMap[String(categoryName || "").toLowerCase()] || "uploaded"
  }

  const fetchBuildingAssets = async () => {
    if (!selectedBuilding) {
      toast({
        title: "No Building Selected",
        description: "Please select a building first",
        variant: "destructive",
      })
      return
    }

    setIsLoadingBuildingAssets(true)
    setPlacedAssetCounts({})
    try {
      // Prefer AssetsList assets assigned to this building (from Create Assets flow)
      const assetsListSnapshot = await getDocs(collection(db, "AssetsList"))
      const assetsListMatches = []

      assetsListSnapshot.forEach((docSnap) => {
        const data = docSnap.data()
        if (!buildingsMatch(data.building || data.buildingName, selectedBuilding)) return

        const displayName = data.itemType || data.assetName || data.assetId || docSnap.id
        assetsListMatches.push({
          id: docSnap.id,
          assetsListId: docSnap.id,
          assetName: displayName,
          name: displayName,
          category: getCategoryKeyForAsset(data.category || data.system),
          subCategory: data.subCategory || "Other",
          system: data.system || "",
          deviceLocation: data.deviceLocation || "",
          deviceAddress: resolveAssetDeviceAddress(data),
          partNumber: data.partNumber || "",
          loopNumber: data.loopNumber ?? "",
          deviceNumber: data.deviceNumber ?? "",
          subAdd: data.subAdd ?? 0,
          building: data.building || selectedBuilding,
          floorMapName: data.floorMapName || data.floorPlanName || "",
          floorPlanName: data.floorPlanName || data.floorMapName || "",
          x: data.x,
          y: data.y,
          assetMode: "building",
          img_url: data.customImageUrl || null,
        })
      })

      if (assetsListMatches.length > 0) {
        const categories = {}
        const categoriesFound = []

        assetsListMatches.forEach((asset) => {
          const categoryKey = asset.category
          if (!categories[categoryKey]) {
            categories[categoryKey] = {
              assets: {},
              categoryInfo: { name: categoryKey },
            }
            categoriesFound.push(categoryKey)
          }
          categories[categoryKey].assets[asset.assetsListId] = asset
        })

        const processedCategories = {}
        categoriesFound.forEach((categoryKey) => {
          const category = categories[categoryKey]
          const subcategoryGroups = {}
          Object.values(category.assets).forEach((asset) => {
            const subcategory = asset.subCategory || "Other"
            if (!subcategoryGroups[subcategory]) subcategoryGroups[subcategory] = []
            subcategoryGroups[subcategory].push(asset)
          })
          processedCategories[categoryKey] = { ...category, subcategories: subcategoryGroups }
        })

        const allCategories = new Set(categoriesFound)
        Object.keys(processedCategories).forEach((categoryKey) => {
          Object.keys(processedCategories[categoryKey].subcategories).forEach((subcategory) => {
            allCategories.add(`${categoryKey}_${subcategory}`)
          })
        })
        setExpandedCategories(allCategories)

        const buildingData = {
          categories,
          categoriesFound,
          totalAssets: assetsListMatches.length,
          status: true,
        }
        setBuildingAssets(buildingData)
        setAvailableAssets(
          assetsListMatches.map((asset) => ({
            id: asset.assetsListId,
            name: asset.name,
            category: asset.category,
            subcategory: asset.subCategory || "Other",
            categoryName: asset.category,
            assetMode: "building",
            img_url: asset.img_url,
            assetsListId: asset.assetsListId,
            floorMapName: asset.floorMapName,
            x: asset.x,
            y: asset.y,
            ...pickMappingDeviceFields(asset),
          })),
        )

        toast({
          title: "Building Assets Loaded",
          description: `Loaded ${assetsListMatches.length} assets from AssetsList for ${selectedBuilding}`,
        })
        return
      }

      const buildingData = await FirestoreService.getBuildingAssets(`${selectedBuilding}BuildingDB`)

      if (buildingData.categoriesFound.length > 0) {
        const totalAssets = Object.values(buildingData.categories).reduce(
          (sum, cat) => sum + Object.keys(cat.assets).length,
          0,
        )
        buildingData.totalAssets = totalAssets
        buildingData.status = true

        setBuildingAssets(buildingData)

        const categoriesFound = buildingData.categoriesFound
        const firestoreAssets = buildingData.categories

        const processedCategories = {}
        categoriesFound.forEach((categoryKey) => {
          const category = firestoreAssets[categoryKey]
          const subcategoryGroups = {}

          Object.values(category.assets).forEach((asset) => {
            const subcategory = asset.subCategory || "Other"
            if (!subcategoryGroups[subcategory]) {
              subcategoryGroups[subcategory] = []
            }
            subcategoryGroups[subcategory].push(asset)
          })

          processedCategories[categoryKey] = {
            ...category,
            subcategories: subcategoryGroups,
          }
        })

        const allCategories = new Set(categoriesFound)
        Object.keys(processedCategories).forEach((categoryKey) => {
          Object.keys(processedCategories[categoryKey].subcategories).forEach((subcategory) => {
            allCategories.add(`${categoryKey}_${subcategory}`)
          })
        })
        setExpandedCategories(allCategories)

        const allAssets = []
        Object.keys(firestoreAssets).forEach((categoryKey) => {
          const category = firestoreAssets[categoryKey]
          Object.keys(category.assets).forEach((assetId) => {
            const asset = category.assets[assetId]
            allAssets.push({
              id: assetId,
              name: asset.assetName || asset.name || assetId,
              category: categoryKey,
              subcategory: asset.subCategory || "Other",
              categoryName: category.categoryInfo?.name || category.name || categoryKey,
              assetMode: "building",
              img_url: asset.img_url || null,
            })
          })
        })
        setAvailableAssets(allAssets)

        toast({
          title: "Building Assets Loaded",
          description: `Loaded ${allAssets.length} assets from ${categoriesFound.length} categories`,
        })
      } else {
        setBuildingAssets(null)
        setAvailableAssets([])
        setExpandedCategories(new Set())
        toast({
          title: "No Building Assets",
          description: "No asset documents were found for this building in Firestore.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching building assets:", error)
      setBuildingAssets(null)
      setAvailableAssets([])
      toast({
        title: "Error",
        description: "Failed to fetch building assets",
        variant: "destructive",
      })
    } finally {
      setIsLoadingBuildingAssets(false)
    }
  }

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      if (file.type.startsWith("image/")) {
        setSelectedImage(file)
        const reader = new FileReader()
        reader.onload = (e) => {
          setImagePreview(e.target?.result)
        }
        reader.readAsDataURL(file)
      } else {
        toast({
          title: "Invalid File",
          description: "Please select an image file",
          variant: "destructive",
        })
      }
    }
  }

  const calculateImageDimensions = () => {
    if (!imageRef.current) return

    const img = imageRef.current
    const containerRect = img.getBoundingClientRect()
    const containerWidth = containerRect.width
    const containerHeight = containerRect.height

    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    const scaleX = containerWidth / naturalWidth
    const scaleY = containerHeight / naturalHeight
    const scale = Math.min(scaleX, scaleY)

    const displayedWidth = naturalWidth * scale
    const displayedHeight = naturalHeight * scale

    const offsetX = (containerWidth - displayedWidth) / 2
    const offsetY = (containerHeight - displayedHeight) / 2

    setActualImageDimensions({
      width: displayedWidth,
      height: displayedHeight,
      offsetX: offsetX,
      offsetY: offsetY,
      naturalWidth: naturalWidth,
      naturalHeight: naturalHeight,
    })
  }

  const handleImageLoad = () => {
    if (imageRef.current) {
      const { offsetWidth, offsetHeight } = imageRef.current
      setImageDimensions({ width: offsetWidth, height: offsetHeight })

      setTimeout(() => {
        calculateImageDimensions()
      }, 100)
    }
  }

  const getEventCoordinates = (event) => {
    if (!imageRef.current) return null

    const rect = imageRef.current.getBoundingClientRect()
    let clientX, clientY

    if (event.type.startsWith("touch")) {
      const touch = event.touches[0] || event.changedTouches[0]
      if (!touch) return null
      clientX = touch.clientX
      clientY = touch.clientY
    } else {
      clientX = event.clientX
      clientY = event.clientY
    }

    const containerX = Math.round(clientX - rect.left)
    const containerY = Math.round(clientY - rect.top)

    return { containerX, containerY }
  }

  const selectAssetForMapping = (asset) => {
    let assetToStore = null
    let displayName = ""

    if (typeof asset === "string") {
      displayName = asset
      assetToStore = availableAssets.find((a) => (typeof a === "string" ? a === asset : a.name === asset))
      if (!assetToStore) {
        assetToStore = { name: asset, category: "Unknown", system: "", assetMode: "general" }
      }
    } else {
      displayName = getAssetPlacementLabel(asset)
      assetToStore = {
        ...asset,
        ...pickMappingDeviceFields(asset),
        id: asset.id,
        assetsListId: asset.assetsListId || asset.id,
        name: displayName,
        category: asset.category,
        subcategory: asset.subcategory ?? asset.subCategory,
        system: asset.system || asset.details?.system || "",
        assetMode: asset.assetMode || assetMode,
        customImageUrl: asset.img_url || asset.customImageUrl || null,
        building: asset.building || selectedBuilding,
        floorMapName: asset.floorMapName || asset.floorPlanName || "",
      }
    }

    setSelectedAssetForMapping(displayName)
    setSelectedAssetDetails(assetToStore)

    toast({
      title: "Asset Selected",
      description: `${isMobile ? "Tap" : "Click"} on the floor plan to place "${displayName}". You can place it multiple times.`,
    })
  }

  const handleImageInteraction = (event) => {
    if (event.type.startsWith("touch")) {
      event.preventDefault()
    }

    if (!selectedAssetDetails) {
      toast({
        title: "No Asset Selected",
        description: "Please select an asset first, then interact with the floor plan",
        variant: "destructive",
      })
      return
    }

    const assetName = selectedAssetForMapping
    const assetsListId = selectedAssetDetails.assetsListId || selectedAssetDetails.id
    const countKey = assetsListId || assetName
    const placedCount = placedAssetCounts[countKey] || 0

    if (assetsListId && hasFloorPosition(selectedAssetDetails)) {
      toast({
        title: "Already Placed",
        description: `"${assetName}" is already placed on floor map "${selectedAssetDetails.floorMapName || selectedAssetDetails.floorPlanName || "unknown"}".`,
        variant: "destructive",
      })
      return
    }

    if (selectedAssetDetails.assetMode === "building" || assetMode === "building") {
      if (assetsListId) {
        if (hasFloorPosition(selectedAssetDetails) || placedCount > 0) {
          toast({
            title: "Already Placed",
            description: `"${assetName}" has already been placed.`,
            variant: "destructive",
          })
          return
        }
      } else {
        let totalCount = 0
        if (buildingAssets?.categories) {
          Object.values(buildingAssets.categories).forEach((cat) => {
            Object.values(cat.assets).forEach((asset) => {
              if ((asset.assetName || asset.name || asset.id) === assetName) {
                totalCount++
              }
            })
          })
        }
        const remainingQty = totalCount - placedCount
        if (totalCount > 0 && remainingQty <= 0) {
          toast({
            title: "No Quantity Available",
            description: `All ${totalCount} units of "${assetName}" have been placed on the map.`,
            variant: "destructive",
          })
          return
        }
      }
    }

    if (!imageRef.current || actualImageDimensions.width === 0) return

    const coordinates = getEventCoordinates(event)
    if (!coordinates) return

    const { containerX, containerY } = coordinates

    if (
      containerX < actualImageDimensions.offsetX ||
      containerX > actualImageDimensions.offsetX + actualImageDimensions.width ||
      containerY < actualImageDimensions.offsetY ||
      containerY > actualImageDimensions.offsetY + actualImageDimensions.height
    ) {
      toast({
        title: "Invalid Placement",
        description: "Please click/tap within the floor plan image area",
        variant: "destructive",
      })
      return
    }

    const imageX = containerX - actualImageDimensions.offsetX
    const imageY = containerY - actualImageDimensions.offsetY

    const scaleX = actualImageDimensions.naturalWidth / actualImageDimensions.width
    const scaleY = actualImageDimensions.naturalHeight / actualImageDimensions.height

    const naturalX = Math.round(imageX * scaleX)
    const naturalY = Math.round(imageY * scaleY)

    // Calculate relative positions as percentages
    // relativeX: percentage from left to right (0 to 100)
    // relativeY: percentage from bottom to top (0 to 100)
    const relativeX = Math.round((naturalX / actualImageDimensions.naturalWidth) * 100)
    const relativeY = Math.round(((actualImageDimensions.naturalHeight - naturalY) / actualImageDimensions.naturalHeight) * 100)

    const resolvedAssetMode = selectedAssetDetails.assetMode || assetMode
    const deviceFields = pickMappingDeviceFields(selectedAssetDetails)
    const newMapping = {
      id: mappingCounter,
      x: naturalX,
      y: naturalY,
      relativeX: relativeX,
      relativeY: relativeY,
      assetName: selectedAssetForMapping,
      category: selectedAssetDetails.category,
      subcategory: selectedAssetDetails.subcategory || "",
      system: selectedAssetDetails.system || "",
      customImageUrl: selectedAssetDetails.customImageUrl || null,
      assetMode: resolvedAssetMode,
      assetId: resolvedAssetMode === "building" ? selectedAssetDetails.id || null : null,
      assetsListId: assetsListId || null,
      floorMapName: floorPlanName || "",
      floorPlanName: floorPlanName || "",
      building: selectedBuilding || selectedAssetDetails.building || "",
      ...deviceFields,
      details: { ...selectedAssetDetails, ...deviceFields },
    }

    setAssetMappings((prev) => [...prev, newMapping])
    setMappingCounter((prev) => prev + 1)
    setPlacedAssetCounts((prev) => ({
      ...prev,
      [countKey]: (prev[countKey] || 0) + 1,
    }))

    toast({
      title: "Asset Placed",
      description: `Placed "${selectedAssetForMapping}" at image coordinates (${naturalX}, ${naturalY})`,
    })
  }

  const toggleCategory = (category) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(category)) {
      newExpanded.delete(category)
    } else {
      newExpanded.add(category)
    }
    setExpandedCategories(newExpanded)
  }

  const removeAssetMapping = (mappingId) => {
    const mappingToRemove = assetMappings.find((mapping) => mapping.id === mappingId)
    setAssetMappings(assetMappings.filter((mapping) => mapping.id !== mappingId))
    if (mappingToRemove?.assetName) {
      setPlacedAssetCounts((prev) => ({
        ...prev,
        [mappingToRemove.assetName]: Math.max(0, (prev[mappingToRemove.assetName] || 0) - 1),
      }))
    }
    toast({
      title: "Asset Removed",
      description: `Removed "${mappingToRemove?.assetName}" from floor plan`,
    })
  }

  const clearAssetSelection = () => {
    setSelectedAssetForMapping("")
    setSelectedAssetDetails(null)
    toast({
      title: "Selection Cleared",
      description: "Asset selection cleared. Select another asset to continue mapping.",
    })
  }

  // Generate building asset ID with consistent format
  const generateBuildingAssetID = (buildingName, assetName, index) => {
    const buildingPart = buildingName
      .trim()
      .toUpperCase()
      .replace(/[,./()]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
    
    const assetPart = assetName
      .trim()
      .toUpperCase()
      .replace(/[,./()]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
    
    const indexPart = String(index).padStart(4, "0")
    return `${buildingPart}_${assetPart}_${indexPart}`
  }

  // Fetch existing assets to determine next index
  const fetchExistingAssets = async (buildingName) => {
    try {
      const assetRef = collection(db, `${buildingName}BuildingDB/asset/fire-life-safety`)
      const querySnapshot = await getDocs(assetRef)
      
      const assetsByName = {}
      querySnapshot.forEach((doc) => {
        const data = doc.data()
        const assetName = data.assetName
        if (!assetsByName[assetName]) {
          assetsByName[assetName] = 0
        }
        assetsByName[assetName]++
      })
      
      return assetsByName
    } catch (error) {
      console.error("Error fetching existing assets:", error)
      return {}
    }
  }

  const handleSubmitFloorPlan = async () => {
    if (!selectedCommunity || !selectedBuilding) {
      toast({
        title: "Missing Selection",
        description: "Please select a community and building first",
        variant: "destructive",
      })
      return
    }

    if (!selectedImage || !floorPlanName || assetMappings.length === 0) {
      toast({
        title: "Missing Information",
        description: "Please provide floor plan name, image, and place at least one asset",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)
    try {
      // Get user information
      const userString = secureLocalStorage.getItem("user")
      if (!userString) {
        toast({
          title: "Authentication Error",
          description: "User information not found",
          variant: "destructive",
        })
        setIsUploading(false)
        return
      }

      const user = parseStoredUser(userString)
      if (!user || !user.email) {
        toast({
          title: "Authentication Error",
          description: "Invalid user data",
          variant: "destructive",
        })
        setIsUploading(false)
        return
      }

      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      
      // Upload image to Firebase Storage
      const timestamp = Date.now()
      const imageFileName = `${floorPlanName}_${timestamp}.${selectedImage.name.split('.').pop()}`
      const storageRef = ref(storage, `floor-plans/${buildingNameWithSuffix}/${imageFileName}`)
      
      await uploadBytes(storageRef, selectedImage)
      const imageUrl = await getDownloadURL(storageRef)
      
      // Create floor plan document in {buildingName}BuildingDB/floorMaps/floors/{floorPlanName}
      await FirestoreService.createFloorPlan(buildingNameWithSuffix, floorPlanName, imageUrl)
      
      const now = new Date().toISOString()
      
      // Helper function to sanitize document IDs
      const sanitizeDocumentId = (id) => {
        return id
          .replace(/[\/\\]/g, "_")
          .replace(/[()]/g, "")
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .substring(0, 100)
      }
      
      // Helper function to get the category key for an asset based on category name
      const getCategoryKey = (categoryName) => {
        const categoryMap = {
          "fire-life-safety": "fire-life-safety",
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
        return categoryMap[categoryName?.toLowerCase()] || "fire-life-safety"
      }

      // Process asset mappings - separate general and building assets
      const existingAssets = await fetchExistingAssets(selectedBuilding)
      const assetOperationPromises = []
      
      // Group mappings by asset type
      const generalAssetMappings = assetMappings.filter((m) => m.assetMode === "general")
      const buildingAssetMappings = assetMappings.filter((m) => m.assetMode === "building")
      
      // 1. Handle general assets - CREATE new asset documents in asset/{category}/
      const generalAssetsByName = {}
      generalAssetMappings.forEach((mapping) => {
        if (!generalAssetsByName[mapping.assetName]) {
          generalAssetsByName[mapping.assetName] = []
        }
        generalAssetsByName[mapping.assetName].push(mapping)
      })

      Object.entries(generalAssetsByName).forEach(([assetName, mappings]) => {
        const existingCount = existingAssets[assetName] || 0
        
        mappings.forEach((mapping, idx) => {
          const sequenceIndex = existingCount + idx + 1
          const buildingAssetID = generateBuildingAssetID(selectedBuilding, assetName, sequenceIndex)
          const categoryKey = getCategoryKey(mapping.category)
          
          const assetDocRef = doc(db, `${selectedBuilding}BuildingDB/asset/${categoryKey}`, buildingAssetID)
          
          const safeRelativeX = typeof mapping.relativeX === "number" ? mapping.relativeX : null
          const safeRelativeY = typeof mapping.relativeY === "number" ? mapping.relativeY : null
          const { deviceAddress, deviceLocation } = resolveMappingDeviceFields(mapping)

          const assetData = {
            buildingAssetId: buildingAssetID,
            buildingName: selectedBuilding,
            buildingId: "",
            communityId: selectedCommunity,
            assetName: assetName,
            mainCategory: mapping.details?.system || mapping.category,
            assetCategory: categoryKey,
            quantity: 1,
            status: "Active",
            ...buildFloorMapPositionPayload({
              floorPlanName,
              building: selectedBuilding,
              x: mapping.x,
              y: mapping.y,
              relativeX: safeRelativeX,
              relativeY: safeRelativeY,
            }),
            // Device information
            deviceLocation,
            deviceAddress,
            partModelNumber: mapping.details?.partModelNumber || "",
            // Floor plan related fields
            installed: false,
            activityStatus: 1,
            enabled: true,
            active: 0,
            customImageUrl: mapping.customImageUrl || null,
            // Metadata
            createdAt: now,
            updatedAt: now,
            createdBy: user.email || user.username || "Unknown",
          }
          
          assetOperationPromises.push(setDoc(assetDocRef, assetData))

          const generalListId = getAssetsListIdFromMapping(mapping)
          if (generalListId) {
            assetOperationPromises.push(
              updateDoc(
                doc(db, "AssetsList", generalListId),
                buildFloorMapAssetsListUpdate({
                  floorPlanName,
                  building: selectedBuilding,
                  x: mapping.x,
                  y: mapping.y,
                  relativeX: safeRelativeX,
                  relativeY: safeRelativeY,
                  mapping,
                  now,
                }),
              ),
            )
          }
        })
      })

      // 2. Handle building assets - UPDATE existing asset documents with floorName and position info
      buildingAssetMappings.forEach((mapping) => {
        const categoryKey = getCategoryKey(mapping.category)
        const safeRelativeX = typeof mapping.relativeX === "number" ? mapping.relativeX : null
        const safeRelativeY = typeof mapping.relativeY === "number" ? mapping.relativeY : null
        const positionPayload = buildFloorMapPositionPayload({
          floorPlanName,
          building: selectedBuilding,
          x: mapping.x,
          y: mapping.y,
          relativeX: safeRelativeX,
          relativeY: safeRelativeY,
        })

        const assetsListId = getAssetsListIdFromMapping(mapping)
        if (assetsListId) {
          assetOperationPromises.push(
            updateDoc(
              doc(db, "AssetsList", assetsListId),
              buildFloorMapAssetsListUpdate({
                floorPlanName,
                building: selectedBuilding,
                x: mapping.x,
                y: mapping.y,
                relativeX: safeRelativeX,
                relativeY: safeRelativeY,
                mapping,
                now,
              }),
            ),
          )
          return
        }

        const assetId =
          mapping.assetId || mapping.details?.buildingAssetId || sanitizeDocumentId(mapping.assetName)
        
        const assetDocRef = doc(db, `${selectedBuilding}BuildingDB/asset/${categoryKey}`, assetId)

        const { deviceAddress, deviceLocation } = resolveMappingDeviceFields(mapping)
        const updateData = {
          ...positionPayload,
          buildingName: selectedBuilding,
          installed: false,
          activityStatus: 1,
          enabled: true,
          active: 0,
          updatedAt: now,
          updatedBy: user.email || user.username || "Unknown",
        }
        if (deviceLocation) updateData.deviceLocation = deviceLocation
        if (deviceAddress) updateData.deviceAddress = deviceAddress
        
        assetOperationPromises.push(
          setDoc(assetDocRef, updateData, { merge: true })
        )
      })

      if (assetOperationPromises.length > 0) {
        await Promise.all(assetOperationPromises)
        console.log(`✓ Processed ${assetOperationPromises.length} asset operations`)
      }
      
      toast({
        title: "Success",
        description: "Floor plan uploaded successfully",
      })

      // Reset form
      setSelectedImage(null)
      setImagePreview(null)
      setFloorPlanName("")
      setAssetMappings([])
      setSelectedAssetForMapping("")
      setMappingCounter(0)
      setImageDimensions({ width: 0, height: 0 })
      setActualImageDimensions({
        width: 0,
        height: 0,
        offsetX: 0,
        offsetY: 0,
        naturalWidth: 0,
        naturalHeight: 0,
      })
    } catch (error) {
      console.error("Error uploading floor plan:", error)
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload floor plan",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const groupedMappings = assetMappings.reduce((acc, mapping) => {
    if (!acc[mapping.assetName]) {
      acc[mapping.assetName] = []
    }
    acc[mapping.assetName].push(mapping)
    return acc
  }, {})

  const renderGeneralAssets = () => {
    if (!selectedSystem) {
      return (
        <Alert>
          <AlertTitle>Select a System</AlertTitle>
          <AlertDescription>Please select a system to view available assets</AlertDescription>
        </Alert>
      )
    }

    const systemAssets = generalAssets.filter((asset) => asset.system === selectedSystem)
    const filteredAssets = systemAssets.filter((asset) =>
      matchesAssetAddressSearch(asset, generalAssetAddressSearch),
    )
    const addressSearchActive = generalAssetAddressSearch.trim().length > 0

    const assetsByCategory = filteredAssets.reduce((acc, asset) => {
      const category = asset.category || "Uncategorized"
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(asset)
      return acc
    }, {})

    return (
      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-green-600" />
              <span className="font-medium text-green-800">{selectedSystem}</span>
            </div>
            <Badge variant="secondary">{filteredAssets.length} assets</Badge>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="general-asset-address-search">Search by Address</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="general-asset-address-search"
              placeholder="e.g. M1-210, 1F/L1/210..."
              value={generalAssetAddressSearch}
              onChange={(e) => setGeneralAssetAddressSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {selectedAssetForMapping && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-800">Ready to Place:</span>
                <Badge variant="default">{selectedAssetForMapping}</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={clearAssetSelection}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-blue-600 mt-1">
              {isMobile ? "Tap" : "Click"} on the floor plan to place this asset
            </p>
          </div>
        )}

        {filteredAssets.length === 0 ? (
          <Alert>
            <AlertTitle>No Assets Found</AlertTitle>
            <AlertDescription>
              {generalAssetAddressSearch.trim()
                ? `No assets match address "${generalAssetAddressSearch.trim()}" for system "${selectedSystem}"`
                : `No assets found for system "${selectedSystem}"`}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {Object.entries(assetsByCategory).map(([category, assets]) => (
            <div key={category} className="border rounded-lg">
              <Button
                variant="ghost"
                className="w-full justify-between p-3 h-auto"
                onClick={() => toggleCategory(category)}
              >
                <div className="flex items-center gap-2">
                  <img
                    src={getIconForCategory(category) || "/placeholder.svg"}
                    alt={category}
                    className="w-5 h-5 object-contain"
                    onError={(e) => {
                      e.target.src = CATEGORY_ICONS["DEFAULT"]
                    }}
                  />
                  <span className="font-medium">{category}</span>
                  <Badge variant="secondary">{assets.length}</Badge>
                </div>
                {addressSearchActive || expandedCategories.has(category) ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              {(addressSearchActive || expandedCategories.has(category)) && (
                <div className="p-3 pt-0 space-y-1">
                  {assets.map((asset) => (
                    <Button
                      key={asset.id}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-left h-auto p-2"
                      onClick={() =>
                        selectAssetForMapping({
                          name: getAssetPlacementLabel(asset),
                          category: asset.category,
                          img_url: asset.customImageUrl,
                          deviceName: getAssetPlacementLabel(asset),
                          assetMode: "general",
                          ...asset,
                        })
                      }
                    >
                      <div className="flex items-center gap-2">
                        <img
                          src={asset.customImageUrl || getIconForCategory(category) || "/placeholder.svg"}
                          alt={getAssetPlacementLabel(asset)}
                          className="w-4 h-4 object-contain"
                          onError={(e) => {
                            e.target.src = CATEGORY_ICONS["DEFAULT"]
                          }}
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm">{getAssetPlacementLabel(asset)}</div>
                          {asset.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {asset.description.substring(0, 50)}
                              {asset.description.length > 50 ? "…" : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        )}
      </div>
    )
  }

  const renderBuildingAssets = () => {
    if (isLoadingBuildingAssets) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )
    }

    if (!buildingAssets) {
      return (
        <Alert>
          <AlertTitle>No Assets Loaded</AlertTitle>
          <AlertDescription>Use &quot;Load Assets from {selectedBuilding || "Building"}&quot; to load building assets from Firestore.</AlertDescription>
        </Alert>
      )
    }

    return (
      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-800">Building Assets Loaded</span>
            </div>
            <Badge variant="secondary">{buildingAssets.categoriesFound?.length || 0} categories</Badge>
          </div>
        </div>

        {selectedAssetForMapping && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-800">Ready to Place:</span>
                <Badge variant="default">{selectedAssetForMapping}</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={clearAssetSelection}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-blue-600 mt-1">
              {isMobile ? "Tap" : "Click"} on the floor plan to place this asset
            </p>
          </div>
        )}

        <div className="space-y-2">
          {buildingAssets.categoriesFound?.map((categoryKey) => {
            const category = buildingAssets.categories[categoryKey]
            const subcategories = Object.keys(category.assets).reduce((acc, assetId) => {
              const asset = category.assets[assetId]
              const subcategory = asset.subCategory || "Other"
              if (!acc[subcategory]) acc[subcategory] = []
              acc[subcategory].push({ ...asset, id: assetId })
              return acc
            }, {})

            return (
              <div key={categoryKey} className="border rounded-lg">
                <Button
                  variant="ghost"
                  className="w-full justify-between p-3 h-auto"
                  onClick={() => toggleCategory(categoryKey)}
                >
                  <div className="flex items-center gap-2">
                    <img
                      src={getIconForCategory(categoryKey) || "/placeholder.svg"}
                      alt={categoryKey}
                      className="w-5 h-5 object-contain"
                      onError={(e) => {
                        e.target.src = CATEGORY_ICONS["DEFAULT"]
                      }}
                    />
                    <span className="font-medium">{category.categoryInfo?.name || category.name || categoryKey}</span>
                    <Badge variant="secondary">{Object.keys(category.assets).length}</Badge>
                  </div>
                  {expandedCategories.has(categoryKey) ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
                {expandedCategories.has(categoryKey) && (
                  <div className="p-3 pt-0 space-y-2">
                    {Object.keys(subcategories).map((subcategory) => (
                      <div key={subcategory}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-between text-left h-auto p-2 mb-1"
                          onClick={() => toggleCategory(`${categoryKey}_${subcategory}`)}
                        >
                          <span className="font-medium text-sm">{subcategory}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {subcategories[subcategory].length}
                            </Badge>
                            {expandedCategories.has(`${categoryKey}_${subcategory}`) ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </Button>
                        {expandedCategories.has(`${categoryKey}_${subcategory}`) && (
                          <div className="ml-4 space-y-1">
                            {(() => {
                              const unplacedAssets = subcategories[subcategory].filter(
                                (asset) => !hasFloorPosition(asset),
                              )

                              // AssetsList items are unique — show one row per asset
                              if (unplacedAssets.some((asset) => asset.assetsListId)) {
                                return unplacedAssets.map((asset) => {
                                  const assetLabel = getAssetPlacementLabel(asset)
                                  const listId = asset.assetsListId || asset.id
                                  const isDisabled = (placedAssetCounts[listId] || 0) > 0

                                  return (
                                    <Button
                                      key={listId}
                                      variant="ghost"
                                      size="sm"
                                      className="w-full justify-between text-left h-auto p-2"
                                      onClick={() =>
                                        selectAssetForMapping({
                                          ...asset,
                                          category: categoryKey,
                                          subcategory,
                                          assetMode: "building",
                                        })
                                      }
                                      disabled={isDisabled}
                                    >
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <img
                                          src={getIconForCategory(categoryKey) || "/placeholder.svg"}
                                          alt={categoryKey}
                                          className="w-4 h-4 object-contain flex-shrink-0"
                                          onError={(e) => {
                                            e.target.src = CATEGORY_ICONS["DEFAULT"]
                                          }}
                                        />
                                        <span className="text-sm truncate">{assetLabel}</span>
                                      </div>
                                      <Badge variant={isDisabled ? "destructive" : "secondary"} className="ml-2 flex-shrink-0">
                                        {isDisabled ? "Placed" : "1/1"}
                                      </Badge>
                                    </Button>
                                  )
                                })
                              }

                              const assetGroups = {}
                              unplacedAssets.forEach((asset) => {
                                const assetName = asset.assetName || asset.name || asset.id
                                if (!assetGroups[assetName]) {
                                  assetGroups[assetName] = { asset, count: 0 }
                                }
                                assetGroups[assetName].count++
                              })

                              return Object.values(assetGroups).map(({ asset, count }) => {
                                const assetName = asset.assetName || asset.name || asset.id
                                const placedCount = placedAssetCounts[assetName] || 0
                                const remainingQty = count - placedCount
                                const isDisabled = remainingQty <= 0

                                return (
                                  <Button
                                    key={asset.id}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-between text-left h-auto p-2"
                                    onClick={() =>
                                      selectAssetForMapping({
                                        ...asset,
                                        category: categoryKey,
                                        subcategory,
                                        assetMode: "building",
                                      })
                                    }
                                    disabled={isDisabled}
                                  >
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <img
                                        src={getIconForCategory(categoryKey) || "/placeholder.svg"}
                                        alt={categoryKey}
                                        className="w-4 h-4 object-contain flex-shrink-0"
                                        onError={(e) => {
                                          e.target.src = CATEGORY_ICONS["DEFAULT"]
                                        }}
                                      />
                                      <span className="text-sm truncate">{getAssetPlacementLabel(asset)}</span>
                                    </div>
                                    <Badge
                                      variant={isDisabled ? "destructive" : remainingQty <= 3 ? "outline" : "secondary"}
                                      className={`ml-2 flex-shrink-0 ${
                                        remainingQty <= 3 && !isDisabled
                                          ? "border-amber-500 text-amber-700 dark:text-amber-400"
                                          : ""
                                      }`}
                                    >
                                      {remainingQty}/{count}
                                    </Badge>
                                  </Button>
                                )
                              })
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (!mounted) {
    return null
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4 md:px-8">
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
                  <BreadcrumbPage>Create Floor Plan</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            {isMobile && (
              <div className="flex items-center gap-1 ml-auto">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Mobile</span>
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 md:gap-6 p-4 md:p-6 pt-0">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">Create Floor Plan<FaqHelpButton articleId="page-floor-config" size="md" /></h1>
            <p className="text-muted-foreground text-sm md:text-base">
              Select a community and building, upload a floor plan, and map assets by {isMobile ? "tapping" : "clicking"}{" "}
              on their locations.
            </p>
          </div>

          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Community & Building Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="communitySelect">Select Community</Label>
                  <Select
                    value={selectedCommunity}
                    onValueChange={setSelectedCommunity}
                    disabled={isLoadingCommunities}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingCommunities ? "Loading communities..." : "Select a community"} />
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="buildingSelect">Select Building</Label>
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
                          {building}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedBuilding && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800">Selected: {selectedBuilding}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5" />
                  Floor Plan Setup
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="floorPlanName">Floor Plan Name</Label>
                  <Input
                    id="floorPlanName"
                    value={floorPlanName}
                    onChange={(e) => setFloorPlanName(e.target.value)}
                    placeholder="Enter floor plan name"
                    disabled={!selectedBuilding}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="imageUpload">Upload Image</Label>
                  <Input
                    id="imageUpload"
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="cursor-pointer"
                    disabled={!selectedBuilding}
                  />
                </div>

                {imageDimensions.width > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>
                      Container Size: {imageDimensions.width} × {imageDimensions.height}px
                    </div>
                    {actualImageDimensions.width > 0 && (
                      <div>
                        Image Size: {Math.round(actualImageDimensions.width)} × {Math.round(actualImageDimensions.height)}px
                        <br />
                        Natural Size: {actualImageDimensions.naturalWidth} × {actualImageDimensions.naturalHeight}px
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Package className="h-5 w-5" />
                Asset Selection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={assetMode} onValueChange={setAssetMode} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="general" className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    General Assets
                  </TabsTrigger>
                  <TabsTrigger value="building" className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Building Assets
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 mt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Button onClick={fetchGeneralAssets} disabled={isLoadingGeneralAssets || !selectedBuilding} className="w-full">
                      {isLoadingGeneralAssets ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>
                      ) : (
                        <><Package className="mr-2 h-4 w-4" />Load General Assets</>
                      )}
                    </Button>

                    {availableSystems.length > 0 && (
                      <Select value={selectedSystem} onValueChange={setSelectedSystem}>
                        <SelectTrigger><SelectValue placeholder="Select a system category" /></SelectTrigger>
                        <SelectContent>
                          {availableSystems.map((system) => (<SelectItem key={system} value={system}>{system}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="building" className="space-y-4 mt-4">
                  <div className="flex gap-4">
                    <Button onClick={fetchBuildingAssets} disabled={isLoadingBuildingAssets || !selectedBuilding} className="flex-1">
                      {isLoadingBuildingAssets ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading Building Assets...</>
                      ) : (
                        <><Building2 className="mr-2 h-4 w-4" />Load Assets from {selectedBuilding || "Building"}</>
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1">
              {(generalAssets.length > 0 || buildingAssets) && (
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {assetMode === "general" ? <Database className="h-5 w-5" /> : <Layers className="h-5 w-5" />}
                      Select Assets to Map
                    </CardTitle>
                    {selectedAssetForMapping && (
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-xs">Selected: {selectedAssetForMapping}</Badge>
                        <Button variant="ghost" size="sm" onClick={clearAssetSelection}><X className="h-3 w-3" /></Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {assetMode === "general"
                      ? renderGeneralAssets()
                      : assetMode === "building" && selectedBuilding && renderBuildingAssets()}
                  </CardContent>
                </Card>
              )}
            </div>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ImageIcon className="h-5 w-5" />
                  Floor Plan Image
                </CardTitle>
                {assetMappings.length > 0 && (
                  <Badge variant="secondary">
                    {assetMappings.length} asset{assetMappings.length !== 1 ? "s" : ""} mapped
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="relative">
                {imagePreview ? (
                  <div className="relative">
                    <img
                      ref={imageRef}
                      src={imagePreview || "/placeholder.svg"}
                      alt="Floor Plan Preview"
                      className="max-w-full max-h-[500px] object-contain"
                      onLoad={handleImageLoad}
                      onClick={handleImageInteraction}
                      onTouchEnd={handleImageInteraction}
                      style={{ cursor: selectedAssetForMapping ? "crosshair" : "default" }}
                    />

                    {assetMappings.map((mapping) => {
                      const x =
                        (mapping.x / actualImageDimensions.naturalWidth) * actualImageDimensions.width +
                        actualImageDimensions.offsetX
                      const y =
                        (mapping.y / actualImageDimensions.naturalHeight) * actualImageDimensions.height +
                        actualImageDimensions.offsetY

                      return (
                        <div
                          key={mapping.id}
                          className="absolute transform -translate-x-1/2 -translate-y-1/2 z-10"
                          style={{ left: `${x}px`, top: `${y}px` }}
                        >
                          <div className="relative group">
                            <img
                              src={getAssetIconUrl(mapping.assetName, mapping.category, mapping.customImageUrl)}
                              alt={mapping.assetName}
                              className="w-6 h-6 object-contain"
                              onError={handleImageError}
                            />
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 w-48 bg-gray-800 text-white text-sm rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 p-2">
                              <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -mt-1 w-0 h-0 border-l-[8px] border-r-[8px] border-b-[8px] border-gray-800 border-t-transparent"></div>
                              <p className="font-bold">{mapping.assetName}</p>
                              <p className="text-xs text-gray-300">{mapping.category}</p>
                              
                              {mapping.details && (
                                <div className="mt-2 text-xs space-y-1">
                                  {(() => {
                                    const keysToIgnore = new Set(["img_url", "customImageUrl", "category", "assetName", "name", "id", "deviceName"]);
                                    return Object.entries(mapping.details)
                                      .filter(([key, value]) => !keysToIgnore.has(key) && value)
                                      .map(([key, value]) => (
                                        <p key={key} className="capitalize truncate">
                                          <span className="font-semibold">{key.replace(/_/g, " ")}:</span> {String(value)}
                                        </p>
                                      ));
                                  })()}
                                </div>
                              )}

                              <button
                                onClick={() => removeAssetMapping(mapping.id)}
                                className="absolute top-1 right-1 text-gray-400 hover:text-gray-100"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <Alert>
                    <AlertTitle>No Floor Plan Image</AlertTitle>
                    <AlertDescription>Please upload a floor plan image to begin mapping assets.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MapPin className="h-5 w-5" />
                  Mapped Assets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {assetMappings.length === 0 ? (
                  <Alert>
                    <AlertTitle>No Assets Mapped</AlertTitle>
                    <AlertDescription>Map assets to the floor plan by selecting them and clicking on the image.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(groupedMappings).map(([assetName, mappings]) => (
                      <div key={assetName} className="border rounded-md p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <img
                              src={getAssetIconUrl(assetName, mappings[0].category, mappings[0].customImageUrl)}
                              alt={assetName}
                              className="w-5 h-5 object-contain"
                              onError={handleImageError}
                            />
                            <span className="font-medium">{assetName}</span>
                            <Badge variant="secondary">{mappings.length}</Badge>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1">
                          {mappings.map((mapping) => (
                            <div key={mapping.id} className="flex items-center justify-between text-sm">
                              <span>Coordinates: ({mapping.x}, {mapping.y})</span>
                              <Button variant="outline" size="xs" onClick={() => removeAssetMapping(mapping.id)}>Remove</Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Save className="h-5 w-5" />
                  Submit Floor Plan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Alert>
                  <AlertTitle>Confirmation</AlertTitle>
                  <AlertDescription>
                    Please confirm that all assets have been mapped correctly before submitting the floor plan.
                  </AlertDescription>
                </Alert>
                <Button onClick={handleSubmitFloorPlan} disabled={isUploading || assetMappings.length === 0} className="w-full mt-4">
                  {isUploading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</>
                  ) : (
                    <><Save className="mr-2 h-4 w-4" />Submit Floor Plan</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}