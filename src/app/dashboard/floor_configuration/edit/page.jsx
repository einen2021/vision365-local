"use client"
import { useState, useEffect, useRef, useCallback } from "react"
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
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Building2,
  Package,
  Loader2,
  Upload,
  ImageIcon,
  Save,
  X,
  Edit3,
  Trash2,
  AlertTriangle,
  Move,
  RotateCcw,
  Search,
  Plus,
  Calendar,
  MapPin,
  ArrowLeft,
  Eye,
  Users,
  Smartphone,
  Database,
  Layers,
  ArrowRight,
  Target,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import dynamic from "next/dynamic"
import Link from "next/link"
import secureLocalStorage from "react-secure-storage"
import { parseStoredUser } from "@/lib/sessionUser"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppData } from "@/hooks/useAppData"
import { db, storage } from "@/config/firebase"
import { collection, getDocs, doc, getDoc, deleteDoc, updateDoc, setDoc, deleteField } from "firebase/firestore"
import {
  buildingsMatch,
  buildFloorMapAssetsListUpdate,
  buildFloorMapPositionPayload,
  buildClearFloorMapPositionPayload,
  getAssetsListIdFromMapping,
  getAssetPlacementLabel,
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

// Utility function to detect mobile devices
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

export default function ManageFloorPlansPage() {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Community and building selection
  const { communities, isLoadingCommunities, isReady, effectiveRole } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [selectedCommunity, setSelectedCommunity] = useState("")
  const [buildings, setBuildings] = useState([])
  const [selectedBuilding, setSelectedBuilding] = useState("")
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false)
  const [buildingStatus, setBuildingStatus] = useState("")
  const userRole = effectiveRole || "User"
  const [buildingModelMeta, setBuildingModelMeta] = useState(null)
  const [selectedModelFile, setSelectedModelFile] = useState(null)
  const [isUploadingModel, setIsUploadingModel] = useState(false)

  // View state management
  const [currentView, setCurrentView] = useState("list") // "list" or "edit"
  const [selectedFloorPlan, setSelectedFloorPlan] = useState(null)

  // List view states
  const [floorPlans, setFloorPlans] = useState([])
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [deletingPlan, setDeletingPlan] = useState(null)

  // Edit view states
  const [floorPlanData, setFloorPlanData] = useState(null)
  const [isLoadingEdit, setIsLoadingEdit] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Image editing states
  const [selectedImage, setSelectedImage] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [isImageDialogOpen, setIsImageDialogOpen] = useState(false)

  // Asset management states
  const [assetMappings, setAssetMappings] = useState([])
  const [draggedAsset, setDraggedAsset] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [selectedAssets, setSelectedAssets] = useState(new Set())
  const [isEditMode, setIsEditMode] = useState(false)

  // Asset management - General Assets
  const [generalAssets, setGeneralAssets] = useState([])
  const [availableSystems, setAvailableSystems] = useState([])
  const [selectedSystem, setSelectedSystem] = useState("")
  const [isLoadingGeneralAssets, setIsLoadingGeneralAssets] = useState(false)

  // Asset management - Building Assets
  const [buildingAssets, setBuildingAssets] = useState(null)
  const [isLoadingBuildingAssets, setIsLoadingBuildingAssets] = useState(false)

  // Asset selection mode and placement
  const [assetMode, setAssetMode] = useState("general") // "general" or "building"
  const [expandedCategories, setExpandedCategories] = useState(new Set())
  const [availableAssets, setAvailableAssets] = useState([])
  const [selectedAssetForMapping, setSelectedAssetForMapping] = useState("")
  const [selectedAssetDetails, setSelectedAssetDetails] = useState(null)
  const [mappingCounter, setMappingCounter] = useState(0)
  const [placedAssetCounts, setPlacedAssetCounts] = useState({}) // Track how many of each asset has been placed
  const [deletedAssets, setDeletedAssets] = useState([]) // Track assets deleted from floor map

  // Image dimensions tracking
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const [actualImageDimensions, setActualImageDimensions] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  })
  const [imageLoaded, setImageLoaded] = useState(false)
  const [browserZoom, setBrowserZoom] = useState(1)

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapContainerRef = useRef(null)

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

  useEffect(() => {
    if (selectedCommunity) {
      const community = communities.find((c) => c.id === selectedCommunity)
      if (community && community.buildings) {
        setBuildings(community.buildings)
        setSelectedBuilding("") // Reset building selection when community changes
        setFloorPlans([]) // Clear floor plans when community changes
      } else {
        setBuildings([])
        setSelectedBuilding("")
        setFloorPlans([])
      }
    } else {
      setBuildings([])
      setSelectedBuilding("")
      setFloorPlans([])
    }
  }, [selectedCommunity, communities])

  useEffect(() => {
    if (selectedBuilding) {
      fetchFloorPlans()
      fetchBuildingStatus()
      fetchBuildingModelMetadata()
    } else {
      setFloorPlans([])
      setBuildingStatus("")
      setBuildingModelMeta(null)
      setSelectedModelFile(null)
    }
  }, [selectedBuilding])

  // Fetch building status
  const fetchBuildingStatus = async () => {
    if (!selectedBuilding) return

    try {
      const status = await FirestoreService.getBuildingStatus(selectedBuilding)
      setBuildingStatus(status || "")
    } catch (error) {
      console.error("Error fetching building status:", error)
      setBuildingStatus("")
    }
  }

  const fetchBuildingModelMetadata = async () => {
    if (!selectedBuilding) return

    try {
      const buildingNameWithSuffix = `${selectedBuilding}BuildingDB`
      const modelDocRef = doc(db, buildingNameWithSuffix, "metadata")
      const snap = await getDoc(modelDocRef)

      if (snap.exists()) {
        setBuildingModelMeta(snap.data())
      } else {
        setBuildingModelMeta(null)
      }
    } catch (error) {
      console.error("Error fetching building model metadata:", error)
      setBuildingModelMeta(null)
    }
  }

  const handleModelFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const lower = file.name.toLowerCase()
    const isValid = lower.endsWith(".fbx") || lower.endsWith(".obj")

    if (!isValid) {
      toast({
        title: "Invalid File",
        description: "Please upload only .fbx or .obj files",
        variant: "destructive",
      })
      event.target.value = ""
      return
    }

    setSelectedModelFile(file)
  }

  const handleUploadBuildingModel = async () => {
    if (!selectedBuilding) {
      toast({
        title: "No Building Selected",
        description: "Select a building before uploading a 3D model",
        variant: "destructive",
      })
      return
    }

    if (!selectedModelFile) {
      toast({
        title: "No File Selected",
        description: "Choose a .fbx or .obj file to upload",
        variant: "destructive",
      })
      return
    }

    setIsUploadingModel(true)
    try {
      const buildingNameWithSuffix = `${selectedBuilding}BuildingDB`
      const userString = secureLocalStorage.getItem("user")
      const user = parseStoredUser(userString) || { email: "Unknown", username: "Unknown" }
      const now = new Date().toISOString()
      const extension = selectedModelFile.name.toLowerCase().endsWith(".fbx") ? "fbx" : "obj"

      const storagePath = `buildings/${buildingNameWithSuffix}/models/building-model.${extension}`
      const fileRef = ref(storage, storagePath)
      await uploadBytes(fileRef, selectedModelFile)
      const modelUrl = await getDownloadURL(fileRef)

      const modelDocRef = doc(db, buildingNameWithSuffix, "metadata")
      const payload = {
        fileName: selectedModelFile.name,
        modelType: extension,
        modelUrl,
        storagePath,
        fileSize: selectedModelFile.size,
        updatedAt: now,
        uploadedBy: user.email || user.username || "Unknown",
      }

      await setDoc(modelDocRef, payload, { merge: true })
      setBuildingModelMeta(payload)
      setSelectedModelFile(null)

      toast({
        title: "Upload Successful",
        description: `3D model uploaded for ${selectedBuilding}`,
      })
    } catch (error) {
      console.error("Error uploading building model:", error)
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload building model",
        variant: "destructive",
      })
    } finally {
      setIsUploadingModel(false)
    }
  }

  // Handle fullscreen toggle
  const handleFullscreen = () => {
    if (!mapContainerRef.current) return

    if (!isFullscreen) {
      // Enter fullscreen
      if (mapContainerRef.current.requestFullscreen) {
        mapContainerRef.current.requestFullscreen().catch((err) => {
          console.error("Error attempting to enable fullscreen:", err)
          // Fallback: show modal overlay
          setIsFullscreen(true)
        })
      } else if (mapContainerRef.current.mozRequestFullScreen) {
        mapContainerRef.current.mozRequestFullScreen()
      } else if (mapContainerRef.current.webkitRequestFullscreen) {
        mapContainerRef.current.webkitRequestFullscreen()
      } else if (mapContainerRef.current.msRequestFullscreen) {
        mapContainerRef.current.msRequestFullscreen()
      } else {
        // Fallback: use modal overlay
        setIsFullscreen(true)
      }
      setIsFullscreen(true)
    } else {
      // Exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else if (document.mozFullScreenElement) {
        document.mozCancelFullScreen()
      } else if (document.webkitFullscreenElement) {
        document.webkitExitFullscreen()
      } else if (document.msFullscreenElement) {
        document.msExitFullscreen()
      }
      setIsFullscreen(false)
    }
  }

  // Handle keyboard escape to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isFullscreen && !document.fullscreenElement) {
        setIsFullscreen(false)
      }
    }

    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown)
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isFullscreen])

  // Recalculate image dimensions when fullscreen state changes
  useEffect(() => {
    if (imageLoaded && imageRef.current) {
      // Use a longer delay to ensure DOM transition completes
      setTimeout(() => {
        calculateImageDimensions()
      }, 150)
    }
  }, [isFullscreen, imageLoaded])

  // Add resize observer to detect zoom changes
  useEffect(() => {
    if (!imageRef.current) return

    const handleResize = () => {
      if (imageLoaded && imageRef.current) {
        calculateImageDimensions()
      }
    }

    // Listen for window resize (which includes zoom changes)
    window.addEventListener('resize', handleResize)

    // Use ResizeObserver for more precise detection
    const resizeObserver = new ResizeObserver(() => {
      if (imageLoaded) {
        calculateImageDimensions()
      }
    })

    if (imageRef.current) {
      resizeObserver.observe(imageRef.current)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
    }
  }, [imageLoaded])

  // List view functions - Fixed to match the view page pattern
  const fetchFloorPlans = async () => {
    if (!selectedBuilding) {
      console.log("No building selected, skipping floor plans fetch")
      return
    }

    setIsLoadingList(true)
    console.log("Fetching floor plans for building:", selectedBuilding)

    try {
      // Add "BuildingDB" suffix like in the view page
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const floorPlans = await FirestoreService.getBuildingFloorMaps(buildingNameWithSuffix)
      
      // Add assetCount field
      const transformedFloorPlans = floorPlans.map(plan => ({
        ...plan,
        assetCount: 0 // Will be populated when we load individual floor plan details
      }))
      
      setFloorPlans(transformedFloorPlans)
      console.log("Floor plans loaded from Firebase:", transformedFloorPlans)
    } catch (error) {
      console.error("Error fetching floor plans:", error)
      toast({
        title: "Error",
        description: `Failed to load floor plans for ${selectedBuilding}. Please try again.`,
        variant: "destructive",
      })
      setFloorPlans([])
    } finally {
      setIsLoadingList(false)
    }
  }

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
    try {
      const assetsListSnapshot = await getDocs(collection(db, "AssetsList"))
      const assetsListMatches = []

      assetsListSnapshot.forEach((docSnap) => {
        const data = docSnap.data()
        if (!buildingsMatch(data.building, selectedBuilding)) return

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

        setBuildingAssets({
          categories,
          categoriesFound,
          totalAssets: assetsListMatches.length,
          status: true,
        })
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

      const buildingData = await FirestoreService.getBuildingAssets(selectedBuilding+"BuildingDB")

      // If we found assets in Firestore, use them
      if (buildingData.categoriesFound.length > 0) {
        // Add totalAssets count
        const totalAssets = Object.values(buildingData.categories).reduce((sum, cat) => sum + Object.keys(cat.assets).length, 0)
        buildingData.totalAssets = totalAssets
        buildingData.status = true
        
        setBuildingAssets(buildingData)
        
        const categoriesFound = buildingData.categoriesFound
        const firestoreAssets = buildingData.categories

        // Group assets by subcategory within each category
        const processedCategories = {}
        categoriesFound.forEach((categoryKey) => {
          const category = firestoreAssets[categoryKey]
          const subcategoryGroups = {}

          // Group assets by subcategory
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

        // Set expanded categories to show all by default
        const allCategories = new Set(categoriesFound)
        // Also expand all subcategories
        Object.keys(processedCategories).forEach((categoryKey) => {
          Object.keys(processedCategories[categoryKey].subcategories).forEach((subcategory) => {
            allCategories.add(`${categoryKey}_${subcategory}`)
          })
        })
        setExpandedCategories(allCategories)

        // Convert building assets to the format expected by the UI
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
              img_url: asset.img_url || null, // Include assetImageUrl
            })
          })
        })
        setAvailableAssets(allAssets)
        
        toast({
          title: "Building Assets Loaded",
          description: `Loaded ${allAssets.length} assets from ${categoriesFound.length} categories`,
        })
      }
    } catch (error) {
      console.error("Error fetching building assets:", error)
      toast({
        title: "Error",
        description: "Failed to fetch building assets",
        variant: "destructive",
      })
    } finally {
      setIsLoadingBuildingAssets(false)
    }
  }

  const selectAssetForMapping = (asset) => {
    let assetToStore = null
    let displayName = ""

    if (typeof asset === "string") {
      // General asset mode (legacy support)
      displayName = asset
      // Find the full asset object from availableAssets
      assetToStore = availableAssets.find((a) => (typeof a === "string" ? a === asset : a.name === asset))
      // If not found, create a basic one
      if (!assetToStore) {
        assetToStore = { name: asset, category: "Unknown", system: "", assetMode: "general" }
      }
    } else {
      // Asset is an object (could be general or building asset)
      displayName = getAssetPlacementLabel(asset)
      assetToStore = {
        ...asset,
        ...pickMappingDeviceFields(asset),
        id: asset.id,
        assetsListId: asset.assetsListId || asset.id,
        name: displayName,
        category: asset.category,
        subcategory: asset.subcategory,
        system: asset.system || asset.details?.system || "",
        assetMode: asset.assetMode || assetMode,
        customImageUrl: asset.img_url || null,
        building: asset.building || selectedBuilding,
        floorMapName: asset.floorMapName || asset.floorPlanName || "",
        x: asset.x,
        y: asset.y,
      }
    }

    setSelectedAssetForMapping(displayName)
    setSelectedAssetDetails(assetToStore)

    toast({
      title: "Asset Selected",
      description: `${isMobile ? "Tap" : "Click"} on the floor plan to place "${displayName}". You can place it multiple times.`,
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

  const toggleCategory = (category) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(category)) {
      newExpanded.delete(category)
    } else {
      newExpanded.add(category)
    }
    setExpandedCategories(newExpanded)
  }

  // Image dimensions calculation
  const detectZoom = () => {
    // Detect browser zoom level
    const zoom = window.devicePixelRatio || 1
    return zoom
  }

  const calculateImageDimensions = () => {
    if (!imageRef.current) return
    const img = imageRef.current
    const containerRect = img.getBoundingClientRect()
    const zoom = detectZoom()
    
    // Account for browser zoom by dividing by zoom factor
    const containerWidth = containerRect.width / zoom
    const containerHeight = containerRect.height / zoom

    // Get natural dimensions
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    // Calculate the scale to fit the image within the container while maintaining aspect ratio
    const scaleX = containerWidth / naturalWidth
    const scaleY = containerHeight / naturalHeight
    const scale = Math.min(scaleX, scaleY)

    // Calculate actual displayed dimensions
    const displayedWidth = naturalWidth * scale
    const displayedHeight = naturalHeight * scale

    // Calculate offset (centering)
    const offsetX = (containerWidth - displayedWidth) / 2
    const offsetY = (containerHeight - displayedHeight) / 2

    setBrowserZoom(zoom)
    setActualImageDimensions({
      width: displayedWidth,
      height: displayedHeight,
      offsetX: offsetX,
      offsetY: offsetY,
      naturalWidth: naturalWidth,
      naturalHeight: naturalHeight,
    })

    console.log("Edit Image Dimensions Calculated:", {
      container: { width: containerWidth, height: containerHeight },
      natural: { width: naturalWidth, height: naturalHeight },
      displayed: { width: displayedWidth, height: displayedHeight },
      offset: { x: offsetX, y: offsetY },
      scale: scale,
      isMobile: isMobile,
    })
  }

  const handleEditFloorPlan = async (floorPlan) => {
    if (!selectedBuilding) {
      toast({
        title: "Error",
        description: "No building selected",
        variant: "destructive",
      })
      return
    }

    setSelectedFloorPlan(floorPlan)
    setIsLoadingEdit(true)
    setCurrentView("edit")
    setImageLoaded(false)
    setDeletedAssets([]) // Reset deleted assets tracking when loading a new floor plan

    console.log("Loading floor plan details:", floorPlan.name, "from building:", selectedBuilding)

    try {
      // Add "BuildingDB" suffix like in the view page
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      
      // Get floor map data using FirestoreService
      const data = await FirestoreService.getFloorMap(buildingNameWithSuffix, floorPlan.name)

      console.log("Floor plan details response:", data)

      setFloorPlanData({
        floorPlanName: data.floorPlanName,
        buildingName: data.buildingName,
        imageUrl: data.imageUrl,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      })
      setImagePreview(data.imageUrl)
      
      // Use the flat asset mappings from FirestoreService
      const flatAssetMappings = data.assetMappings || []
      console.log("Loaded asset mappings:", flatAssetMappings)
      setAssetMappings(flatAssetMappings)
      
      // Calculate initial placed asset counts from loaded mappings
      const initialPlacedCounts = {}
      flatAssetMappings.forEach((mapping) => {
        const assetName = mapping.assetName
        initialPlacedCounts[assetName] = (initialPlacedCounts[assetName] || 0) + 1
      })
      setPlacedAssetCounts(initialPlacedCounts)
    } catch (error) {
      console.error("Error fetching floor plan details:", error)
      toast({
        title: "Error",
        description: "Failed to load floor plan details. Please try again.",
        variant: "destructive",
      })
      setCurrentView("list")
    } finally {
      setIsLoadingEdit(false)
    }
  }

  const handleDeleteFloorPlan = async (floorPlanName) => {
    if (!selectedBuilding) {
      toast({
        title: "Error",
        description: "No building selected",
        variant: "destructive",
      })
      return
    }

    setDeletingPlan(floorPlanName)
    try {
      // Add "BuildingDB" suffix
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      
      // Delete floor map using FirestoreService
      await FirestoreService.deleteFloorMap(buildingNameWithSuffix, floorPlanName)

      setFloorPlans((prev) => prev.filter((plan) => plan.name !== floorPlanName))
      toast({
        title: "Success",
        description: "Floor plan deleted successfully",
      })
      // If we're currently editing the deleted floor plan, go back to list
      if (selectedFloorPlan?.name === floorPlanName) {
        handleBackToList()
      }
    } catch (error) {
      console.error("Error deleting floor plan:", error)
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete floor plan",
        variant: "destructive",
      })
    } finally {
      setDeletingPlan(null)
    }
  }

  const handleBackToList = () => {
    setCurrentView("list")
    setSelectedFloorPlan(null)
    setFloorPlanData(null)
    setImagePreview(null)
    setSelectedImage(null)
    setAssetMappings([])
    setSelectedAssets(new Set())
    setIsEditMode(false)
    setIsImageDialogOpen(false)
    setImageLoaded(false)
    setDeletedAssets([]) // Reset deleted assets tracking
    // Reset dimensions
    setImageDimensions({ width: 0, height: 0 })
    setActualImageDimensions({
      width: 0,
      height: 0,
      offsetX: 0,
      offsetY: 0,
      naturalWidth: 0,
      naturalHeight: 0,
    })
  }

  // Edit view functions
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

  const handleImageLoad = () => {
    if (imageRef.current) {
      const { offsetWidth, offsetHeight } = imageRef.current
      setImageDimensions({ width: offsetWidth, height: offsetHeight })
      setImageLoaded(true)
      console.log("Edit Container Dimensions:", { width: offsetWidth, height: offsetHeight })
      // Calculate actual image dimensions and position
      setTimeout(() => {
        calculateImageDimensions()
      }, 100) // Small delay to ensure image is fully rendered
    }
  }

  const handleUpdateImage = async () => {
    if (!selectedImage || !selectedFloorPlan || !selectedBuilding) {
      toast({
        title: "No Image Selected",
        description: "Please select an image to update",
        variant: "destructive",
      })
      return
    }
    setIsSaving(true)
    try {
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      
      // Upload image to Firebase Storage
      // Update floor map image using FirestoreService
      const imageUrl = await FirestoreService.updateFloorMapImage(buildingNameWithSuffix, selectedFloorPlan.name, selectedImage)

      setFloorPlanData((prev) => ({ ...prev, imageUrl: imageUrl }))
      setImagePreview(imageUrl)
      setIsImageDialogOpen(false)
      setSelectedImage(null)
      
      // Update the floor plan in the list as well
      setFloorPlans((prev) =>
        prev.map((plan) => (plan.name === selectedFloorPlan.name ? { ...plan, imageUrl: imageUrl } : plan)),
      )
      
      toast({
        title: "Success",
        description: "Floor plan image updated successfully",
      })
      
      // Recalculate dimensions after image update
      setTimeout(() => {
        calculateImageDimensions()
      }, 500)
    } catch (error) {
      console.error("Error updating image:", error)
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update image",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  // Unified function to get coordinates from both mouse and touch events
  const getEventCoordinates = (event) => {
    if (!imageRef.current) return null
    const rect = imageRef.current.getBoundingClientRect()
    let clientX, clientY

    // Handle both mouse and touch events
    if (event.type === "touchstart" || event.type === "touchmove" || event.type === "touchend") {
      // For touch events, use the first touch point
      if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX
        clientY = event.touches[0].clientY
      } else if (event.changedTouches && event.changedTouches.length > 0) {
        // For touchend, use changedTouches
        clientX = event.changedTouches[0].clientX
        clientY = event.changedTouches[0].clientY
      } else {
        return null
      }
    } else {
      // For mouse events
      clientX = event.clientX
      clientY = event.clientY
    }

    // Get coordinates relative to the container
    const containerX = Math.round(clientX - rect.left)
    const containerY = Math.round(clientY - rect.top)

    return { containerX, containerY }
  }

  // Convert display coordinates to natural image coordinates
  const displayToNaturalCoordinates = (displayX, displayY) => {
    if (actualImageDimensions.width === 0 || actualImageDimensions.height === 0) return { x: 0, y: 0 }

    // Remove zoom compensation first
    const unzoomedX = displayX / browserZoom
    const unzoomedY = displayY / browserZoom

    // Convert container coordinates to image coordinates
    const imageX = unzoomedX - actualImageDimensions.offsetX
    const imageY = unzoomedY - actualImageDimensions.offsetY

    // Convert to natural image coordinates (for storage)
    const scaleX = actualImageDimensions.naturalWidth / actualImageDimensions.width
    const scaleY = actualImageDimensions.naturalHeight / actualImageDimensions.height

    const naturalX = Math.round(imageX * scaleX)
    const naturalY = Math.round(imageY * scaleY)

    return { x: naturalX, y: naturalY }
  }

  // Convert natural image coordinates to display coordinates
  const naturalToDisplayCoordinates = (naturalX, naturalY) => {
    if (actualImageDimensions.naturalWidth === 0 || actualImageDimensions.naturalHeight === 0) return { x: 0, y: 0 }

    // Convert natural coordinates to display coordinates for rendering
    const scaleX = actualImageDimensions.width / actualImageDimensions.naturalWidth
    const scaleY = actualImageDimensions.height / actualImageDimensions.naturalHeight

    const baseDisplayX = naturalX * scaleX + actualImageDimensions.offsetX
    const baseDisplayY = naturalY * scaleY + actualImageDimensions.offsetY

    // Apply zoom compensation
    const displayX = baseDisplayX * browserZoom
    const displayY = baseDisplayY * browserZoom

    return { x: displayX, y: displayY }
  }

  const handleAssetInteractionStart = useCallback(
    (event, asset) => {
      if (!isEditMode) return
      event.preventDefault()
      const coordinates = getEventCoordinates(event)
      if (!coordinates) return

      const { containerX, containerY } = coordinates

      // Convert asset's natural coordinates to display coordinates for proper offset calculation
      const { x: displayX, y: displayY } = naturalToDisplayCoordinates(asset.x, asset.y)

      const offsetX = containerX - displayX
      const offsetY = containerY - displayY

      setDraggedAsset(asset)
      setDragOffset({ x: offsetX, y: offsetY })
    },
    [isEditMode, actualImageDimensions],
  )

  const handleInteractionMove = useCallback(
    (event) => {
      if (!draggedAsset || !imageRef.current || actualImageDimensions.width === 0) return
      event.preventDefault()
      const coordinates = getEventCoordinates(event)
      if (!coordinates) return

      const { containerX, containerY } = coordinates

      // Calculate new position in container coordinates
      const newDisplayX = containerX - dragOffset.x
      const newDisplayY = containerY - dragOffset.y

      // Check if the new position is within the actual image bounds
      if (
        newDisplayX < actualImageDimensions.offsetX ||
        newDisplayX > actualImageDimensions.offsetX + actualImageDimensions.width ||
        newDisplayY < actualImageDimensions.offsetY ||
        newDisplayY > actualImageDimensions.offsetY + actualImageDimensions.height
      ) {
        return // Don't update position if outside image bounds
      }

      // Convert display coordinates to natural coordinates for storage
      const { x: naturalX, y: naturalY } = displayToNaturalCoordinates(newDisplayX, newDisplayY)

      setAssetMappings((prev) =>
        prev.map((asset) => (asset.id === draggedAsset.id ? { ...asset, x: naturalX, y: naturalY } : asset)),
      )
    },
    [draggedAsset, dragOffset, actualImageDimensions],
  )

  const handleInteractionEnd = useCallback(() => {
    if (draggedAsset) {
      toast({
        title: "Asset Moved",
        description: `Moved "${draggedAsset.assetName}" to new position`,
      })
    }
    setDraggedAsset(null)
    setDragOffset({ x: 0, y: 0 })
  }, [draggedAsset, toast])

  useEffect(() => {
    if (draggedAsset) {
      // Add both mouse and touch event listeners
      document.addEventListener("mousemove", handleInteractionMove)
      document.addEventListener("mouseup", handleInteractionEnd)
      document.addEventListener("touchmove", handleInteractionMove, { passive: false })
      document.addEventListener("touchend", handleInteractionEnd)

      return () => {
        document.removeEventListener("mousemove", handleInteractionMove)
        document.removeEventListener("mouseup", handleInteractionEnd)
        document.removeEventListener("touchmove", handleInteractionMove)
        document.removeEventListener("touchend", handleInteractionEnd)
      }
    }
  }, [draggedAsset, handleInteractionMove, handleInteractionEnd])

  const handleAssetSelect = (assetId) => {
    const newSelected = new Set(selectedAssets)
    if (newSelected.has(assetId)) {
      newSelected.delete(assetId)
    } else {
      newSelected.add(assetId)
    }
    setSelectedAssets(newSelected)
  }

  const handleDeleteSelectedAssets = () => {
    const assetsToDelete = assetMappings.filter((asset) => selectedAssets.has(asset.id))
    setAssetMappings((prev) => prev.filter((asset) => !selectedAssets.has(asset.id)))
    
    // Track deleted assets for later removal of position fields from Firestore
    setDeletedAssets((prev) => [...prev, ...assetsToDelete])
    
    // Decrement placed counts for all deleted assets
    const countUpdates = {}
    assetsToDelete.forEach(asset => {
      if (asset.assetName) {
        countUpdates[asset.assetName] = (countUpdates[asset.assetName] || 0) + 1
      }
    })
    
    setPlacedAssetCounts(prev => {
      const updated = { ...prev }
      Object.entries(countUpdates).forEach(([assetName, count]) => {
        updated[assetName] = Math.max(0, (updated[assetName] || 0) - count)
      })
      return updated
    })
    
    setSelectedAssets(new Set())
    toast({
      title: "Assets Deleted",
      description: `Removed ${assetsToDelete.length} asset(s) from floor plan`,
    })
  }

  const handleDeleteSingleAsset = (assetId) => {
    const assetToDelete = assetMappings.find((asset) => asset.id === assetId)
    setAssetMappings((prev) => prev.filter((asset) => asset.id !== assetId))
    
    // Track deleted asset for later removal of position fields from Firestore
    if (assetToDelete) {
      setDeletedAssets((prev) => [...prev, assetToDelete])
    }
    
    // Decrement placed count for this asset
    if (assetToDelete?.assetName) {
      setPlacedAssetCounts(prev => ({
        ...prev,
        [assetToDelete.assetName]: Math.max(0, (prev[assetToDelete.assetName] || 0) - 1)
      }))
    }
    
    toast({
      title: "Asset Deleted",
      description: `Removed "${assetToDelete?.assetName}" from floor plan`,
    })
  }

  const handleSaveChanges = async () => {
    if (!selectedFloorPlan || !selectedBuilding) return

    setIsSaving(true)
    try {
      console.log("Original asset mappings before formatting:", assetMappings)
      
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const now = new Date().toISOString()
      
      // Get user information
      const userString = secureLocalStorage.getItem("user")
      const user = parseStoredUser(userString) || { email: "Unknown", username: "Unknown" }

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

      // Process all current asset mappings to save to asset/{category}/ collections
      const assetOperationPromises = []
      
      assetMappings.forEach((asset, index) => {
        const categoryKey = getCategoryKey(asset.category)
        const sanitizedAssetName = sanitizeDocumentId(asset.assetName)
        
        const assetMode = asset.assetMode || (asset.assetId ? "building" : "general")
        const safeRelativeX = typeof asset.relativeX === "number" ? asset.relativeX : null
        const safeRelativeY = typeof asset.relativeY === "number" ? asset.relativeY : null
        const positionPayload = buildFloorMapPositionPayload({
          floorPlanName: selectedFloorPlan.name,
          building: selectedBuilding,
          x: asset.x,
          y: asset.y,
          relativeX: safeRelativeX,
          relativeY: safeRelativeY,
        })

        const assetsListId = getAssetsListIdFromMapping(asset)
        if (assetsListId) {
          assetOperationPromises.push(
            updateDoc(
              doc(db, "AssetsList", assetsListId),
              buildFloorMapAssetsListUpdate({
                floorPlanName: selectedFloorPlan.name,
                building: selectedBuilding,
                x: asset.x,
                y: asset.y,
                relativeX: safeRelativeX,
                relativeY: safeRelativeY,
                mapping: asset,
                now,
              }),
            ),
          )
          return
        }

        let assetId
        if (assetMode === "building" && asset.assetId) {
          assetId = asset.assetId
        } else if (asset.id && asset.id.includes("mapping_")) {
          assetId = `${sanitizedAssetName}_${index}`
        } else {
          assetId = asset.id || `${sanitizedAssetName}_${index}`
        }

        const assetDocRef = doc(db, buildingNameWithSuffix, "asset", categoryKey, assetId)

        const { deviceAddress, deviceLocation } = resolveMappingDeviceFields(asset)
        const assetData = assetMode === "building" 
          ? {
              ...positionPayload,
              buildingName: selectedBuilding,
              installed: asset.installed || false,
              activityStatus: asset.activityStatus !== undefined ? asset.activityStatus : 1,
              enabled: asset.enabled !== undefined ? asset.enabled : true,
              active: asset.active || 0,
              updatedAt: now,
              updatedBy: user.email || user.username || "Unknown",
              ...(deviceLocation ? { deviceLocation } : {}),
              ...(deviceAddress ? { deviceAddress } : {}),
            }
          : {
              buildingAssetId: assetId,
              buildingName: selectedBuilding,
              buildingId: "",
              communityId: selectedCommunity || "",
              assetName: asset.assetName,
              mainCategory: asset.system || asset.category,
              assetCategory: categoryKey,
              quantity: 1,
              status: "Active",
              assetMode: "general",
              ...positionPayload,
              deviceLocation,
              deviceAddress,
              partModelNumber: asset.partModelNumber || "",
              installed: asset.installed || false,
              activityStatus: asset.activityStatus !== undefined ? asset.activityStatus : 1,
              enabled: asset.enabled !== undefined ? asset.enabled : true,
              active: asset.active || 0,
              customImageUrl: asset.customImageUrl || null,
              createdAt: asset.createdAt || now,
              updatedAt: now,
              createdBy: user.email || user.username || "Unknown",
            }

        if (assetMode === "building") {
          assetOperationPromises.push(setDoc(assetDocRef, assetData, { merge: true }))
        } else {
          assetOperationPromises.push(setDoc(assetDocRef, assetData))
        }
      })

      if (assetOperationPromises.length > 0) {
        await Promise.all(assetOperationPromises)
        console.log(`✓ Saved/updated ${assetOperationPromises.length} asset documents to asset/{category}/ collections`)
      }

      // Handle deleted assets - remove position fields but keep coordinates object
      const deleteFieldPromises = []
      deletedAssets.forEach((asset) => {
        const assetsListId = getAssetsListIdFromMapping(asset)
        if (assetsListId) {
          deleteFieldPromises.push(
            updateDoc(doc(db, "AssetsList", assetsListId), {
              ...buildClearFloorMapPositionPayload(),
              updatedAt: now,
            }),
          )
          return
        }

        const categoryKey = getCategoryKey(asset.category)
        const sanitizedAssetName = sanitizeDocumentId(asset.assetName)
        const assetMode = asset.assetMode || (asset.assetId ? "building" : "general")
        
        let assetId
        if (assetMode === "building" && asset.assetId) {
          assetId = asset.assetId
        } else if (asset.id) {
          assetId = asset.id
        } else {
          assetId = sanitizedAssetName
        }
        
        const assetDocRef = doc(db, buildingNameWithSuffix, "asset", categoryKey, assetId)
        
        // Remove only the position fields, keep everything else including coordinates object
        deleteFieldPromises.push(
          updateDoc(assetDocRef, {
            x: deleteField(),
            y: deleteField(),
            relativeX: deleteField(),
            relativeY: deleteField(),
            floorPlanName: deleteField(),
            floorMapName: deleteField(),
            position: deleteField(),
            updatedAt: now,
            updatedBy: user.email || user.username || "Unknown",
          })
        )
      })
      
      if (deleteFieldPromises.length > 0) {
        await Promise.all(deleteFieldPromises)
        console.log(`✓ Removed position fields from ${deleteFieldPromises.length} deleted asset(s)`)
      }
      
      // Clear deleted assets tracking
      setDeletedAssets([])

      toast({
        title: "Success",
        description: "Asset positions saved successfully",
      })
      setIsEditMode(false)
      setSelectedAssets(new Set())
      // Update the floor plan in the list
      setFloorPlans((prev) =>
        prev.map((plan) =>
          plan.name === selectedFloorPlan.name
            ? { ...plan, assetCount: assetMappings.length, updatedAt: new Date() }
            : plan,
        ),
      )
    } catch (error) {
      console.error("Error saving changes:", error)
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save changes",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const resetChanges = () => {
    if (selectedFloorPlan) {
      handleEditFloorPlan(selectedFloorPlan)
    }
    setIsEditMode(false)
    setSelectedAssets(new Set())
    setDeletedAssets([]) // Clear deleted assets tracking on reset
    toast({
      title: "Changes Reset",
      description: "All changes have been reverted",
    })
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown"
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString()
  }

  const filteredFloorPlans = floorPlans.filter((plan) => plan.name.toLowerCase().includes(searchTerm.toLowerCase()))

  // Get selected community name for display
  const selectedCommunityName = communities.find((c) => c.id === selectedCommunity)?.communityName || ""

  const handleImageClick = (event) => {
    if (!isEditMode) return

    const rect = imageRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // If we have an asset selected for mapping, place it
    if (selectedAssetForMapping && selectedAssetDetails) {
      // Check if asset has remaining quantity
      const assetName = selectedAssetForMapping
      const placedCount = placedAssetCounts[assetName] || 0
      
      // Count how many of this asset exist in total from building assets
      const totalAvailable = assetMappings.filter(a => a.assetName === assetName).length + 
        (buildingAssets ? Object.values(buildingAssets.categories).reduce((count, cat) => {
          return count + Object.values(cat.assets).filter(a => 
            (a.assetName || a.name || a.id) === assetName
          ).length
        }, 0) : 0)
      
      // For building assets, check if we have available quantity
      if (selectedAssetDetails.assetMode === "building") {
        // Count total available from buildingAssets
        let totalCount = 0
        if (buildingAssets && buildingAssets.categories) {
          Object.values(buildingAssets.categories).forEach((cat) => {
            Object.values(cat.assets).forEach((asset) => {
              if ((asset.assetName || asset.name || asset.id) === assetName) {
                totalCount++
              }
            })
          })
        }
        
        const remainingQty = totalCount - placedCount
        
        if (remainingQty <= 0) {
          toast({
            title: "No Quantity Available",
            description: `All ${totalCount} units of "${assetName}" have been placed on the map.`,
            variant: "destructive",
          })
          return
        }
      }
      
      // Convert display coordinates to natural coordinates for storage
      const { x: naturalX, y: naturalY } = displayToNaturalCoordinates(x, y)

      // Calculate relative positions as percentages
      // relativeX: percentage from left to right (0 to 100)
      // relativeY: percentage from bottom to top (0 to 100)
      const relativeX = Math.round((naturalX / actualImageDimensions.naturalWidth) * 100)
      const relativeY = Math.round(((actualImageDimensions.naturalHeight - naturalY) / actualImageDimensions.naturalHeight) * 100)

      const deviceFields = pickMappingDeviceFields(selectedAssetDetails)
      const newMapping = {
        id: `mapping_${mappingCounter}`,
        assetName: selectedAssetForMapping,
        category: selectedAssetDetails.category,
        subcategory: selectedAssetDetails.subcategory || "",
        system: selectedAssetDetails.system || "",
        x: naturalX,
        y: naturalY,
        relativeX: relativeX,
        relativeY: relativeY,
        assetMode: selectedAssetDetails.assetMode || assetMode,
        assetId: selectedAssetDetails.id || null,
        assetsListId: selectedAssetDetails.assetsListId || selectedAssetDetails.id || null,
        floorMapName: selectedFloorPlan?.name || "",
        floorPlanName: selectedFloorPlan?.name || "",
        building: selectedBuilding || selectedAssetDetails.building || "",
        customImageUrl: selectedAssetDetails.customImageUrl || null,
        ...deviceFields,
        details: { ...selectedAssetDetails, ...deviceFields },
      }

      setAssetMappings([...assetMappings, newMapping])
      setMappingCounter(mappingCounter + 1)
      
      // Increment placed count for this asset
      setPlacedAssetCounts(prev => ({
        ...prev,
        [assetName]: (prev[assetName] || 0) + 1
      }))

      toast({
        title: "Asset Placed",
        description: `"${selectedAssetDetails.name}" placed on floor plan at (${Math.round(naturalX)}, ${Math.round(naturalY)})`,
      })
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
                  <BreadcrumbPage>
                    {currentView === "list" ? "Manage Floor Plans" : `Edit: ${selectedFloorPlan?.name}`}
                  </BreadcrumbPage>
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
          {currentView === "list" ? (
            // LIST VIEW
            <>
              {/* Header Section */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">Manage Floor Plans<FaqHelpButton articleId="page-floor-edit" size="md" /></h1>
                    <p className="text-muted-foreground text-sm md:text-base">
                      Select a community and building to view and manage floor plans
                    </p>
                  </div>
                  <Link href="/floor-plans/create">
                    <Button className="w-full md:w-auto">
                      <Plus className="h-4 w-4 mr-2" />
                      Create New Floor Plan
                    </Button>
                  </Link>
                </div>

                {/* Community and Building Selection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Users className="h-5 w-5" />
                      Community & Building Selection
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      {/* Community Selection */}
                      <div className="space-y-2">
                        <Label htmlFor="communitySelect">Select Community</Label>
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
                                <div className="flex items-center justify-between w-full">
                                  <span>{community.communityName}</span>
                                  <Badge variant="secondary" className="ml-2">
                                    {community.buildings?.length || 0} buildings
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Building Selection */}
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
                                  ? "Select community first"
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

                      {/* Search Floor Plans */}
                      {selectedBuilding && (
                        <div className="space-y-2">
                          <Label>Search Floor Plans</Label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Search floor plans..."
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="pl-10"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Selection Summary */}
                    {selectedCommunity && selectedBuilding && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Users className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium text-green-800">Community: {selectedCommunityName}</span>
                          <Separator orientation="vertical" className="h-4" />
                          <Building2 className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium text-green-800">Building: {selectedBuilding}</span>
                          <Badge variant="secondary" className="ml-2">
                            {floorPlans.length} floor plans
                          </Badge>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Building 3D Model Upload (Building-level, not floor-level) */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Package className="h-5 w-5" />
                      Building 3D Model
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor="buildingModelUpload">Upload .fbx or .obj</Label>
                        <Input
                          id="buildingModelUpload"
                          type="file"
                          accept=".fbx,.obj"
                          disabled={!selectedBuilding || isUploadingModel}
                          onChange={handleModelFileChange}
                        />
                        <p className="text-xs text-muted-foreground">
                          This uploads one model per building and saves metadata under {" "}
                          <span className="font-mono">{selectedBuilding || "{BuildingName}"}BuildingDB/metadata</span>
                        </p>
                      </div>
                      <div className="flex items-end">
                        <Button
                          className="w-full"
                          onClick={handleUploadBuildingModel}
                          disabled={!selectedBuilding || !selectedModelFile || isUploadingModel}
                        >
                          {isUploadingModel ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4 mr-2" />
                              Upload Model
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {!selectedBuilding && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>Select a building first to upload its 3D model.</AlertDescription>
                      </Alert>
                    )}

                    {selectedModelFile && (
                      <div className="text-sm text-muted-foreground">
                        Selected file: <span className="font-medium">{selectedModelFile.name}</span>
                      </div>
                    )}

                    {buildingModelMeta && selectedBuilding && (
                      <div className="p-3 bg-muted/40 rounded-md border text-sm space-y-1">
                        <div>
                          <span className="font-medium">Current Model:</span> {buildingModelMeta.fileName || "-"}
                        </div>
                        <div>
                          <span className="font-medium">Type:</span> {(buildingModelMeta.modelType || "-").toUpperCase()}
                        </div>
                        <div>
                          <span className="font-medium">Updated:</span> {buildingModelMeta.updatedAt ? new Date(buildingModelMeta.updatedAt).toLocaleString() : "-"}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Floor Plans Grid */}
              {!selectedCommunity ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Users className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Select a Community</h3>
                    <p className="text-muted-foreground text-center">
                      Choose a community from the dropdown above to view its buildings and floor plans
                    </p>
                  </CardContent>
                </Card>
              ) : !selectedBuilding ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Select a Building</h3>
                    <p className="text-muted-foreground text-center">
                      Choose a building from "{selectedCommunityName}" to view its floor plans
                    </p>
                  </CardContent>
                </Card>
              ) : isLoadingList ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : filteredFloorPlans.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">
                      {searchTerm ? "No floor plans found" : "No floor plans yet"}
                    </h3>
                    <p className="text-muted-foreground text-center mb-4">
                      {searchTerm
                        ? `No floor plans match "${searchTerm}" in ${selectedBuilding}`
                        : `No floor plans found for ${selectedBuilding} in ${selectedCommunityName}`}
                    </p>
                    {!searchTerm && (
                      <Link href="/dashboard/floor_configuration/">
                        <Button>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Floor Plan
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {filteredFloorPlans.map((floorPlan) => (
                    <Card key={floorPlan.name} className="overflow-hidden">
                      <div className="aspect-video relative bg-muted">
                        {floorPlan.imageUrl ? (
                          <img
                            src={floorPlan.imageUrl || "/placeholder.svg"}
                            alt={floorPlan.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <ImageIcon className="h-12 w-12 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg">{floorPlan.name}</CardTitle>
                        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {selectedCommunityName}
                          </div>
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {selectedBuilding}
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {floorPlan.assetCount || 0} assets
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(floorPlan.updatedAt || floorPlan.createdAt)}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1 bg-transparent"
                            onClick={() => handleEditFloorPlan(floorPlan)}
                          >
                            <Edit3 className="h-4 w-4 mr-2" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm" disabled={deletingPlan === floorPlan.name}>
                                {deletingPlan === floorPlan.name ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Floor Plan</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{floorPlan.name}" from {selectedBuilding}? This
                                  action cannot be undone and will permanently delete all associated asset mappings.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteFloorPlan(floorPlan.name)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete Permanently
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : (
            // EDIT VIEW
            <>
              {isLoadingEdit ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Header Section */}
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <Button variant="outline" onClick={handleBackToList}>
                          <ArrowLeft className="h-4 w-4 mr-2" />
                          Back to List
                        </Button>
                        <div>
                          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Edit Floor Plan</h1>
                          <p className="text-muted-foreground text-sm md:text-base">
                            Modify the image and adjust asset positions for "{selectedFloorPlan?.name}" in{" "}
                            {selectedBuilding}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
                        {isEditMode && (
                          <>
                            <Button
                              variant="outline"
                              onClick={resetChanges}
                              className="w-full md:w-auto bg-transparent"
                            >
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Reset Changes
                            </Button>
                            <Button onClick={handleSaveChanges} disabled={isSaving} className="w-full md:w-auto">
                              {isSaving ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4 mr-2" />
                              )}
                              Save Changes
                            </Button>
                          </>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              disabled={deletingPlan === selectedFloorPlan?.name}
                              className="w-full md:w-auto"
                            >
                              {deletingPlan === selectedFloorPlan?.name ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-2" />
                              )}
                              Delete Floor Plan
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Floor Plan</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{selectedFloorPlan?.name}" from {selectedBuilding}?
                                This action cannot be undone. All associated asset mappings will also be permanently
                                deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteFloorPlan(selectedFloorPlan?.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete Permanently
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>

                  {/* Control Panel */}
                  <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <ImageIcon className="h-5 w-5" />
                          Image Management
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Dialog open={isImageDialogOpen} onOpenChange={setIsImageDialogOpen}>
                          <DialogTrigger asChild>
                            <Button className="w-full">
                              <Edit3 className="h-4 w-4 mr-2" />
                              Edit Image
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md">
                            <DialogHeader>
                              <DialogTitle>Update Floor Plan Image</DialogTitle>
                              <DialogDescription>
                                Select a new image to replace the current floor plan image.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="imageUpload">Select New Image</Label>
                                <Input
                                  id="imageUpload"
                                  type="file"
                                  accept="image/*"
                                  onChange={handleImageUpload}
                                  className="cursor-pointer"
                                />
                              </div>
                              {selectedImage && (
                                <div className="text-sm text-muted-foreground">Selected: {selectedImage.name}</div>
                              )}
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setIsImageDialogOpen(false)}>
                                Cancel
                              </Button>
                              <Button onClick={handleUpdateImage} disabled={!selectedImage || isSaving}>
                                {isSaving ? (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                  <Upload className="h-4 w-4 mr-2" />
                                )}
                                Update Image
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                        <div className="text-sm text-muted-foreground">
                          Current image will be replaced when you upload a new one.
                        </div>
                        {/* Debug info for image dimensions */}
                        {imageDimensions.width > 0 && (
                          <div className="text-xs text-muted-foreground space-y-1">
                            <div>
                              Container Size: {imageDimensions.width} × {imageDimensions.height}px
                            </div>
                            {actualImageDimensions.width > 0 && (
                              <div>
                                Image Size: {Math.round(actualImageDimensions.width)} ×{" "}
                                {Math.round(actualImageDimensions.height)}px
                                <br />
                                Natural Size: {actualImageDimensions.naturalWidth} ×{" "}
                                {actualImageDimensions.naturalHeight}px
                                <br />
                                Offset: ({Math.round(actualImageDimensions.offsetX)},{" "}
                                {Math.round(actualImageDimensions.offsetY)})
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Move className="h-5 w-5" />
                          Asset Controls
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Button
                          onClick={() => setIsEditMode(!isEditMode)}
                          variant={isEditMode ? "default" : "outline"}
                          className="w-full"
                        >
                          {isEditMode ? (
                            <>
                              <Eye className="h-4 w-4 mr-2" />
                              View Mode
                            </>
                          ) : (
                            <>
                              <Edit3 className="h-4 w-4 mr-2" />
                              Edit Mode
                            </>
                          )}
                        </Button>
                        {isEditMode && (
                          <>
                            <div className="text-sm text-muted-foreground">
                              {isMobile ? "Tap and drag" : "Click and drag"} assets to move them.{" "}
                              {isMobile ? "Tap" : "Click"} assets to select/deselect.
                            </div>
                            {selectedAssets.size > 0 && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="destructive" className="w-full">
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Selected ({selectedAssets.size})
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Selected Assets</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete {selectedAssets.size} selected asset(s)? This
                                      action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={handleDeleteSelectedAssets}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete Assets
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Package className="h-5 w-5" />
                          Asset Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Building:</span>
                            <Badge variant="secondary">{selectedBuilding}</Badge>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Total Assets:</span>
                            <Badge variant="secondary">{assetMappings.length}</Badge>
                          </div>
                          {selectedAssets.size > 0 && (
                            <div className="flex justify-between text-sm">
                              <span>Selected:</span>
                              <Badge variant="default">{selectedAssets.size}</Badge>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-2">
                            {isEditMode ? "Edit mode active" : "View mode"}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {isEditMode && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Plus className="h-5 w-5" />
                          Add New Assets
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
                              <Button
                                onClick={fetchGeneralAssets}
                                disabled={isLoadingGeneralAssets || !selectedBuilding}
                                className="w-full"
                              >
                                {isLoadingGeneralAssets ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Loading...
                                  </>
                                ) : (
                                  <>
                                    <Package className="mr-2 h-4 w-4" />
                                    Load General Assets
                                  </>
                                )}
                              </Button>

                              {availableSystems.length > 0 && (
                                <Select value={selectedSystem} onValueChange={setSelectedSystem}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a system category" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableSystems.map((system) => (
                                      <SelectItem key={system} value={system}>
                                        {system}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>

                            {/* General Assets Display */}
                            {selectedSystem && generalAssets.length > 0 && (() => {
                              const filteredAssets = generalAssets.filter(asset => asset.system === selectedSystem)
                              
                              // Group by category
                              const assetsByCategory = filteredAssets.reduce((acc, asset) => {
                                const category = asset.category || "Uncategorized"
                                if (!acc[category]) {
                                  acc[category] = []
                                }
                                acc[category].push(asset)
                                return acc
                              }, {})

                              if (filteredAssets.length === 0) {
                                return (
                                  <Alert>
                                    <AlertTitle>No Assets Found</AlertTitle>
                                    <AlertDescription>No assets found for system "{selectedSystem}"</AlertDescription>
                                  </Alert>
                                )
                              }

                              return (
                                <div className="space-y-4">
                                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <Database className="h-4 w-4 text-green-600" />
                                        <span className="font-medium text-green-800">{selectedSystem}</span>
                                      </div>
                                      <Badge variant="secondary">{filteredAssets.length} assets</Badge>
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

                                  <div className="max-h-64 overflow-y-auto space-y-2">
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
                                          {expandedCategories.has(category) ? (
                                            <ChevronUp className="h-4 w-4" />
                                          ) : (
                                            <ChevronDown className="h-4 w-4" />
                                          )}
                                        </Button>
                                        {expandedCategories.has(category) && (
                                          <div className="p-3 pt-0 space-y-1">
                                            {assets.map((asset) => (
                                              <Button
                                                key={asset.id}
                                                variant="ghost"
                                                size="sm"
                                                className="w-full justify-start text-left h-auto p-2"
                                                onClick={() => selectAssetForMapping({
                                                  name: getAssetPlacementLabel(asset),
                                                  category: asset.category,
                                                  img_url: asset.customImageUrl,
                                                  deviceName: getAssetPlacementLabel(asset),
                                                  ...asset
                                                })}
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
                                                        {asset.description.substring(0, 50)}...
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
                                </div>
                              )
                            })()}
                          </TabsContent>

                          <TabsContent value="building" className="space-y-4 mt-4">
                            <div className="flex gap-4">
                              <Button
                                onClick={fetchBuildingAssets}
                                disabled={isLoadingBuildingAssets || !selectedBuilding}
                                className="flex-1"
                              >
                                {isLoadingBuildingAssets ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Loading Building Assets...
                                  </>
                                ) : (
                                  <>
                                    <Building2 className="mr-2 h-4 w-4" />
                                    Load Assets from {selectedBuilding || "Building"}
                                  </>
                                )}
                              </Button>
                            </div>

                            {/* Building Assets Display */}
                            {buildingAssets && (
                              <div className="space-y-4">
                                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Layers className="h-4 w-4 text-blue-600" />
                                      <span className="font-medium text-blue-800">Building Assets Loaded</span>
                                    </div>
                                    <Badge variant="secondary">
                                      {buildingAssets.categoriesFound?.length || 0} categories
                                    </Badge>
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

                                <div className="max-h-64 overflow-y-auto space-y-2">
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
                                            <span className="font-medium">
                                              {category.categoryInfo?.name || categoryKey}
                                            </span>
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
                                                      // Group assets by name to show count
                                                      const assetGroups = {}
                                                      subcategories[subcategory].forEach((asset) => {
                                                        const assetName = asset.assetName || asset.name || asset.id
                                                        if (!assetGroups[assetName]) {
                                                          assetGroups[assetName] = {
                                                            asset: asset,
                                                            count: 0,
                                                          }
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
                                                                subcategory: subcategory,
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
                                                              <span className="text-sm truncate">
                                                                {getAssetPlacementLabel(asset)}
                                                              </span>
                                                            </div>
                                                            <Badge 
                                                              variant={isDisabled ? "destructive" : remainingQty <= 3 ? "outline" : "secondary"} 
                                                              className={`ml-2 flex-shrink-0 ${remainingQty <= 3 && !isDisabled ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}`}
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
                            )}
                          </TabsContent>
                        </Tabs>
                      </CardContent>
                    </Card>
                  )}

                  {/* Floor Plan Display */}
                  <Card className="flex-1">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Building2 className="h-5 w-5" />
                            Floor Plan: {selectedFloorPlan?.name} ({selectedBuilding})
                            {buildingStatus && (
                              <span className="text-sm font-normal text-muted-foreground">
                                - {buildingStatus.charAt(0).toUpperCase() + buildingStatus.slice(1)}
                              </span>
                            )}
                            {isEditMode && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                Edit Mode -{" "}
                                {isMobile ? "Tap and drag to move, Tap to select" : "Drag to move, Click to select"}
                              </Badge>
                            )}
                          </CardTitle>
                        </div>
                        {imagePreview && (
                          <Button
                            onClick={handleFullscreen}
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            title={isFullscreen ? "Exit Fullscreen (ESC)" : "Enter Fullscreen"}
                          >
                            {isFullscreen ? (
                              <Minimize2 className="h-4 w-4" />
                            ) : (
                              <Maximize2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-2 md:p-4">
                      {imagePreview ? (
                        <div
                          ref={mapContainerRef}
                          className={`relative border rounded-lg overflow-hidden bg-gray-50 ${
                            isFullscreen ? "fixed inset-0 z-50 rounded-none border-0" : ""
                          }`}
                        >
                          <img
                            ref={imageRef}
                            src={imagePreview || "/placeholder.svg"}
                            alt="Floor plan"
                            className={`block w-full h-auto max-w-full ${isEditMode ? (isMobile ? "cursor-pointer" : "cursor-crosshair") : "cursor-default"}`}
                            onLoad={handleImageLoad}
                            onClick={handleImageClick}
                            style={{
                              objectFit: "contain",
                              objectPosition: "center",
                              maxHeight: isFullscreen ? "100vh" : isMobile ? "400px" : "600px",
                              touchAction: "manipulation", // Prevent zoom on double tap
                            }}
                          />
                          {assetMappings.map((asset) => {
                            // Convert natural coordinates to display coordinates for rendering
                            const { x: displayX, y: displayY } = naturalToDisplayCoordinates(asset.x, asset.y)
                            return (
                              <div
                                key={asset.id}
                                className={`absolute z-10 group ${
                                  isEditMode ? (isMobile ? "cursor-pointer" : "cursor-move") : "cursor-default"
                                } ${selectedAssets.has(asset.id) ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
                                style={{
                                  left: displayX,
                                  top: displayY,
                                  transform: `translate(-50%, -50%) scale(${1 / browserZoom})`,
                                  transformOrigin: "center",
                                }}
                                onMouseDown={(e) => handleAssetInteractionStart(e, asset)}
                                onTouchStart={(e) => handleAssetInteractionStart(e, asset)}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isEditMode) {
                                    handleAssetSelect(asset.id)
                                  }
                                }}
                              >
                                <div className="relative">
                                  <img
                                    src={getIconForCategory(asset.category, asset.customImageUrl) || "/placeholder.svg"}
                                    alt={asset.category}
                                    className={`object-contain shadow-lg border-2 border-white rounded bg-white transition-all ${isMobile ? "w-7 h-7" : "w-9 h-9"} ${
                                      selectedAssets.has(asset.id) ? "scale-110" : ""
                                    } ${draggedAsset?.id === asset.id ? "scale-125 shadow-xl" : ""}`}
                                    style={{
                                      minWidth: isMobile ? "28px" : "36px",
                                      minHeight: isMobile ? "28px" : "36px",
                                    }}
                                    onError={(e) => {
                                      e.target.src = CATEGORY_ICONS["DEFAULT"]
                                    }}
                                  />
                                  {/* Asset tooltip */}
                                  <div
                                    className={`absolute ${isMobile ? "top-8" : "top-10"} left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap max-w-32 truncate opacity-0 group-hover:opacity-100 transition-opacity z-20`}
                                  >
                                    {asset.assetName}
                                    <div className="text-xs opacity-75">
                                      Natural: ({asset.x}, {asset.y})
                                    </div>
                                    <div className="text-xs opacity-75">
                                      Display: ({Math.round(displayX)}, {Math.round(displayY)})
                                    </div>
                                  </div>
                                  {/* Delete button for individual assets in edit mode */}
                                  {isEditMode && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          className={`absolute -top-2 -right-2 p-0 opacity-0 group-hover:opacity-100 transition-opacity ${isMobile ? "h-6 w-6" : "h-5 w-5"}`}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <X className={isMobile ? "h-4 w-4" : "h-3 w-3"} />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Delete Asset</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Are you sure you want to delete "{asset.assetName}" from this floor plan?
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() => handleDeleteSingleAsset(asset.id)}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          >
                                            Delete Asset
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                          {isFullscreen && (
                            <Button
                              onClick={handleFullscreen}
                              variant="destructive"
                              size="sm"
                              className="absolute top-4 right-4 z-50 gap-2"
                            >
                              <Minimize2 className="h-4 w-4" />
                              Exit Fullscreen
                            </Button>
                          )}

                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg h-[300px] md:h-[600px] flex items-center justify-center">
                          <div className="text-center">
                            <ImageIcon className="mx-auto h-12 w-12 md:h-16 md:w-16 text-gray-400" />
                            <p className="mt-4 text-base md:text-lg text-gray-500">No image available</p>
                            <p className="text-sm text-gray-400">Use the Edit Image button to upload a new image</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Status Bar */}
                  {isEditMode && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Edit Mode Active</AlertTitle>
                      <AlertDescription>
                        You are currently in edit mode. Changes will not be saved until you {isMobile ? "tap" : "click"}{" "}
                        "Save Changes".
                        {selectedAssets.size > 0 && ` ${selectedAssets.size} asset(s) selected.`}
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </>
          )}

          {/* Footer row: User Role | Time and date | logo */}
          <div className="flex items-center justify-between text-sm text-muted-foreground px-4 py-3 border-t mt-4">
            <div>{userRole || "User"}</div>
            <div>{new Date().toLocaleString()}</div>
            <div><img src="/logo.png" alt="Logo" className="h-6 w-auto" /></div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}