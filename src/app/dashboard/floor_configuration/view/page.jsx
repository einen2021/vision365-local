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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Building2, Loader2, ImageIcon, MapPin, Eye, Info, Wifi, WifiOff, Users, Smartphone, Power, PowerOff, CheckCircle, XCircle, Edit, Maximize2, Minimize2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import dynamic from "next/dynamic"
import secureLocalStorage from "react-secure-storage"
import { useAppData } from "@/hooks/useAppData"
import { Button } from "@/components/ui/button"
import { db } from "@/config/firebase"
import { doc, getDoc, updateDoc, setDoc, collection, query, where, getDocs, onSnapshot } from "firebase/firestore"
import FirestoreService from "@/services/firestoreService"
import {
  loadFloorMapAssetsFromAssetsList,
  mergeAssetsListIntoAssetMappings,
  getFloorMapName,
  hasFloorPosition,
} from "@/lib/floorMapAssets"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"
import { getIconForCategory, handleImageError } from "@/lib/assetIcons"
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl"
import {
  getAssetMarkerTooltip,
  getFireBorderColor,
  getFireDimColor,
  getFireRadarColor,
  getFireStatusDisplay,
  resolveMarkerActive,
  shouldFireRipple,
} from "@/lib/assetFireStatus"
import { useFireStatusCache } from "@/stores/assetFireStatusStore"


// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

// Floor marker colours driven by panel simplexStatus.F (via background cache)
const getRadarColor = getFireRadarColor
const getDimColor = getFireDimColor
const getRadarBorderColor = getFireBorderColor
const shouldAnimate = shouldFireRipple

// Utility function to detect mobile devices
const isMobileDevice = () => {
  if (typeof navigator === "undefined") return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

function FloorPlanThumbnail({ imageUrl, alt, className = "w-20 h-20 object-cover rounded mb-2 border" }) {
  const src = useResolvedAssetUrl(imageUrl)
  if (!imageUrl) return null
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => {
        e.target.style.display = "none"
      }}
    />
  )
}

export default function ViewFloorPlanPage() {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Community selection
  const { communities, isLoadingCommunities, isReady, effectiveRole } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [selectedCommunity, setSelectedCommunity] = useState("")

  // Building and floor plan selection
  const [buildings, setBuildings] = useState([])
  const [selectedBuilding, setSelectedBuilding] = useState("")
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false)

  const [floorPlans, setFloorPlans] = useState([])
  const [selectedFloorPlan, setSelectedFloorPlan] = useState("")
  const [floorPlanData, setFloorPlanData] = useState(null)
  const floorPlanImageUrl = useResolvedAssetUrl(floorPlanData?.imageUrl)
  const [activeStatuses, setActiveStatuses] = useState({})
  const [assetDeviceData, setAssetDeviceData] = useState({}) // Store deviceLocation and deviceAddress by document ID
  const [isLoadingFloorPlans, setIsLoadingFloorPlans] = useState(false)
  const [isLoadingFloorPlanData, setIsLoadingFloorPlanData] = useState(false)
  const [buildingStatus, setBuildingStatus] = useState("")

  const [isConnected, setIsConnected] = useState(false)
  const [connectionType, setConnectionType] = useState("none") // "sse", "polling", "none"
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const [lastUpdate, setLastUpdate] = useState(null)

  // State for THEMORA building's acknowledge button
  const [ackStatus, setAckStatus] = useState(false)
  const [isAckLoading, setIsAckLoading] = useState(false)

  // State for asset control modal
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false)
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false)
  const userRole = effectiveRole || ""
  const [deviceLocation, setDeviceLocation] = useState("")
  const [deviceAddress, setDeviceAddress] = useState("")
  const [installed, setInstalled] = useState(false)

  // New state for tracking actual image dimensions and position
  const [actualImageDimensions, setActualImageDimensions] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  })
  const [browserZoom, setBrowserZoom] = useState(1)

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapContainerRef = useRef(null)

  const imageRef = useRef(null)
  const eventSourceRef = useRef(null)
  const pollingIntervalRef = useRef(null)
  const unsubscribesRef = useRef([]) // Store real-time listener unsubscribe functions
  const { toast } = useToast()

  const fireStatusCache = useFireStatusCache()

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
      if (community) {
        setBuildings(community.buildings || [])
      }
    } else {
      setBuildings([])
    }
    // Reset downstream selections
    setSelectedBuilding("")
    setSelectedFloorPlan("")
    setFloorPlanData(null)
    setActiveStatuses({})
    setLastUpdate(null)
    stopRealTimeUpdates()
  }, [selectedCommunity, communities])

  useEffect(() => {
    if (selectedBuilding) {
      fetchFloorPlans()
      fetchBuildingStatus()
      if (selectedBuilding === "THEMORA") {
        fetchAckStatus()
      }
    } else {
      setFloorPlans([])
      setSelectedFloorPlan("")
      setBuildingStatus("")
    }
  }, [selectedBuilding])

  // Setup real-time updates when floor plan is selected
  useEffect(() => {
    if (selectedBuilding && selectedFloorPlan && floorPlanData) {
      startRealTimeUpdates()
    } else {
      stopRealTimeUpdates()
    }

    return () => {
      stopRealTimeUpdates()
    }
  }, [selectedBuilding, selectedFloorPlan, floorPlanData])

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
  }

  const startRealTimeUpdates = () => {
    stopRealTimeUpdates()
    if (typeof EventSource !== "undefined") {
      trySSEConnection()
    } else {
      startPolling()
    }
  }

  const stopRealTimeUpdates = () => {
    // Clean up real-time listeners
    unsubscribesRef.current.forEach((unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribe()
      }
    })
    unsubscribesRef.current = []

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setIsConnected(false)
    setConnectionType("none")
  }

  const trySSEConnection = () => {
    // Since we're using Firebase SDK directly, we'll use Firestore real-time listeners
    startRealtimeListeners()
  }

  const startPolling = () => {
    // Fallback polling for browsers without real-time support
    setConnectionType("polling")
    setIsConnected(true)
    fetchActiveStatuses()
    pollingIntervalRef.current = setInterval(fetchActiveStatuses, 2000)
  }

  const startRealtimeListeners = () => {
    if (!selectedBuilding || !selectedFloorPlan || !floorPlanData?.assetDocRefs) {
      startPolling() // Fallback to polling
      return
    }

    setConnectionType("firestore-realtime")
    setIsConnected(true)

    const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
    const categoryKeys = [
      "fire-life-safety",
      "electrical",
      "hvac",
      "plumbing",
      "elv",
      "security",
      "vertical-transport",
      "lighting",
      "bms",
      "landscaping",
      "additional",
    ]

    // Set up listeners for each category to watch assets on this floor
    categoryKeys.forEach((categoryKey) => {
      try {
        const categoryRef = collection(db, buildingNameWithSuffix, "asset", categoryKey)
        
        const unsubscribe = onSnapshot(
          categoryRef,
          (snapshot) => {
            setActiveStatuses((prevStatuses) => {
              const updatedStatuses = { ...prevStatuses }
              let hasChanges = false

              snapshot.forEach((assetDoc) => {
                const data = assetDoc.data()
                
                // Only track assets on this floor
                if (data.floorPlanName === selectedFloorPlan && typeof data.x === "number" && typeof data.y === "number") {
                  const assetId = data.buildingAssetId || assetDoc.id
                  
                  const newStatus = {
                    active: data.active || 0,
                    activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
                    enabled: data.enabled !== undefined ? data.enabled : true,
                    installed: data.installed || false,
                    lastUpdated: new Date().toISOString(),
                  }

                  // Check if status changed
                  if (JSON.stringify(updatedStatuses[assetId]) !== JSON.stringify(newStatus)) {
                    updatedStatuses[assetId] = newStatus
                    hasChanges = true
                  }
                }
              })

              if (hasChanges) {
                setLastUpdate(new Date())
              }

              return updatedStatuses
            })
          },
          (error) => {
            console.error(`Error setting up real-time listener for ${categoryKey}:`, error)
            // Fallback to polling if real-time listener fails
            startPolling()
          }
        )

        unsubscribesRef.current.push(unsubscribe)
      } catch (error) {
        console.error(`Error setting up listener for category ${categoryKey}:`, error)
      }
    })
  }

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

  const fetchFloorPlans = async () => {
    if (!selectedBuilding) return

    setIsLoadingFloorPlans(true)
    try {
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const floorPlansList = await FirestoreService.getBuildingFloorMaps(buildingNameWithSuffix)
      setFloorPlans(floorPlansList)
    } catch (error) {
      console.error("Error fetching floor plans:", error)
      toast({
        title: "Error",
        description: "Failed to fetch floor plans",
        variant: "destructive",
      })
    } finally {
      setIsLoadingFloorPlans(false)
    }
  }

  const fetchFloorPlanData = async (floorPlanName) => {
    if (!floorPlanName || !selectedBuilding) return

    setIsLoadingFloorPlanData(true)
    setImageLoaded(false)
    setActualImageDimensions({ width: 0, height: 0, offsetX: 0, offsetY: 0, naturalWidth: 0, naturalHeight: 0 })

    try {
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const floorRef = doc(db, buildingNameWithSuffix, "floorMaps", "floors", floorPlanName)
      const floorDoc = await getDoc(floorRef)

      if (!floorDoc.exists()) {
        throw new Error("Floor plan not found")
      }

      const floorData = floorDoc.data()

      // Fetch assets from asset/{category}/ collections that have matching floorName
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "elv",
        "security",
        "vertical-transport",
        "lighting",
        "bms",
        "landscaping",
        "additional",
      ]

      const assetMappings = {}
      const initialActiveStatuses = {}
      const assetDocRefs = {} // Store refs for real-time listening

      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(db, buildingNameWithSuffix, "asset", categoryKey)
          const categorySnapshot = await getDocs(categoryCollection)

          categorySnapshot.forEach((assetDoc) => {
            const data = assetDoc.data()
            
            // Only include assets placed on this floor (floorMapName/floorPlanName + x,y)
            const assetFloorName = getFloorMapName(data)
            if (assetFloorName === floorPlanName && hasFloorPosition(data)) {
              const category = data.mainCategory || categoryKey
              const assetName = data.assetName || assetDoc.id

              if (!assetMappings[category]) {
                assetMappings[category] = {}
              }
              if (!assetMappings[category][assetName]) {
                assetMappings[category][assetName] = []
              }

              const assetData = {
                id: data.buildingAssetId || assetDoc.id,
                x: data.x,
                y: data.y,
                relativeX: data.relativeX,
                relativeY: data.relativeY,
                floorMapName: assetFloorName,
                floorPlanName: assetFloorName,
                building: data.building || data.buildingName || selectedBuilding,
                active: data.active || 0,
                customImageUrl: data.customImageUrl || null,
                deviceLocation: data.deviceLocation || "",
                deviceAddress: data.deviceAddress || "",
                installed: data.installed || false,
                activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
                enabled: data.enabled !== undefined ? data.enabled : true,
                assetName: assetName,
                category: category,
                categoryKey: categoryKey, // Store actual categoryKey for updates
              }

              assetMappings[category][assetName].push(assetData)

              initialActiveStatuses[data.buildingAssetId || assetDoc.id] = {
                active: assetData.active,
                activityStatus: assetData.activityStatus,
                enabled: assetData.enabled,
                installed: assetData.installed,
                lastUpdated: new Date().toISOString(),
              }

              // Store reference for real-time listening
              assetDocRefs[data.buildingAssetId || assetDoc.id] = {
                categoryKey,
                docId: assetDoc.id,
              }
            }
          })
        } catch (error) {
          console.error(`Error fetching category ${categoryKey}:`, error)
          // Continue with other categories
        }
      }

      const assetsListMappings = await loadFloorMapAssetsFromAssetsList(
        db,
        selectedBuilding,
        floorPlanName,
      )
      const mergedAssetMappings = mergeAssetsListIntoAssetMappings(
        assetMappings,
        assetsListMappings,
      )

      assetsListMappings.forEach((asset) => {
        initialActiveStatuses[asset.id] = {
          active: asset.active || 0,
          activityStatus: asset.activityStatus,
          enabled: asset.enabled,
          installed: asset.installed,
          lastUpdated: new Date().toISOString(),
        }
        assetDocRefs[asset.id] = {
          categoryKey: asset.categoryKey || "uploaded",
          docId: asset.id,
          source: "AssetsList",
        }
      })

      const floorPlanDataObj = {
        floorPlanName: floorData.floorPlanName || floorPlanName,
        buildingName: floorData.buildingName || selectedBuilding,
        imageUrl: floorData.imageUrl,
        assetMappings: mergedAssetMappings,
        createdAt: floorData.createdAt,
        updatedAt: floorData.updatedAt,
        assetDocRefs: assetDocRefs, // Store refs for real-time updates
      }

      setFloorPlanData(floorPlanDataObj)
      setActiveStatuses(initialActiveStatuses)
      setLastUpdate(new Date())
    } catch (error) {
      console.error("Error fetching floor plan data:", error)
      toast({
        title: "Error",
        description: "Failed to fetch floor plan data",
        variant: "destructive",
      })
    } finally {
      setIsLoadingFloorPlanData(false)
    }
  }

  const fetchActiveStatuses = async () => {
    if (!selectedBuilding || !selectedFloorPlan) return

    try {
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "elv",
        "security",
        "vertical-transport",
        "lighting",
        "bms",
        "landscaping",
        "additional",
      ]

      const activeStatuses = {}

      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(db, buildingNameWithSuffix, "asset", categoryKey)
          const categorySnapshot = await getDocs(categoryCollection)

          categorySnapshot.forEach((assetDoc) => {
            const data = assetDoc.data()
            
            // Only include assets that are placed on this floor
            if (data.floorPlanName === selectedFloorPlan && typeof data.x === "number" && typeof data.y === "number") {
              const assetId = data.buildingAssetId || assetDoc.id
              
              activeStatuses[assetId] = {
                active: data.active || 0,
                activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
                enabled: data.enabled !== undefined ? data.enabled : true,
                installed: data.installed || false,
                lastUpdated: new Date().toISOString(),
              }
            }
          })
        } catch (error) {
          console.error(`Error fetching category ${categoryKey}:`, error)
          // Continue with other categories
        }
      }

      setActiveStatuses(activeStatuses)
      setLastUpdate(new Date())
    } catch (error) {
      console.error("Error fetching active statuses:", error)
    }
  }
  
  // Fetch Acknowledge status for THEMORA building
  const fetchAckStatus = async () => {
    setIsAckLoading(true)
    try {
      const actionsRef = doc(db, "THEMORABuildingDB", "actions")
      const actionsSnap = await getDoc(actionsRef)
      
      if (actionsSnap.exists()) {
        const actionsData = actionsSnap.data()
        if (typeof actionsData.ack !== "undefined") {
          setAckStatus(actionsData.ack)
        } else {
          setAckStatus(false) // Default to false if not found
        }
      } else {
        setAckStatus(false) // Default to false if document doesn't exist
      }
    } catch (error) {
      console.error("Error fetching ACK status:", error)
      toast({
        title: "Error",
        description: "Failed to fetch building action status.",
        variant: "destructive",
      })
    } finally {
      setIsAckLoading(false)
    }
  }
  
  // Handle Acknowledge button click for THEMORA building
  const handleAckClick = async () => {
    setIsAckLoading(true)
    const updatedAckState = !ackStatus

    // Optimistic UI update
    setAckStatus(updatedAckState)

    try {
      const userString = secureLocalStorage.getItem("user")
      if (!userString) throw new Error("User not logged in.")
      
      const actionsRef = doc(db, "THEMORABuildingDB", "actions")
      await updateDoc(actionsRef, {
        ack: updatedAckState,
      })
      
      toast({
        title: "Success",
        description: `Acknowledge status set to ${updatedAckState ? "Active" : "Inactive"}.`,
      })
    } catch (error) {
      console.error("Error updating ACK status:", error)
      setAckStatus(!updatedAckState) // Revert UI on failure
      toast({
        title: "Error",
        description: "Failed to update Acknowledge status.",
        variant: "destructive",
      })
    } finally {
      setIsAckLoading(false)
    }
  }


  const handleCommunitySelection = (communityId) => {
    setSelectedCommunity(communityId)
  }

  const handleBuildingSelection = (buildingName) => {
    setSelectedBuilding(buildingName)
    setSelectedFloorPlan("")
    setFloorPlanData(null)
    setActiveStatuses({})
    setLastUpdate(null)
    stopRealTimeUpdates()
  }

  const handleFloorPlanSelection = (floorPlanName) => {
    setSelectedFloorPlan(floorPlanName)
    setFloorPlanData(null)
    setActiveStatuses({})
    setLastUpdate(null)
    stopRealTimeUpdates()
    fetchFloorPlanData(floorPlanName)
  }

  const handleImageLoad = () => {
    setImageLoaded(true)
    if (imageRef.current) {
      const { offsetWidth, offsetHeight } = imageRef.current
      setImageDimensions({ width: offsetWidth, height: offsetHeight })
      setTimeout(calculateImageDimensions, 100)
    }
  }

  // Function to render asset mappings with real-time active status
  const renderAssetMappings = () => {
    if (!floorPlanData?.assetMappings || !imageLoaded || actualImageDimensions.width === 0) return null

    // Flatten nested assetMappings into a list of locations
    const flat = []
    Object.entries(floorPlanData.assetMappings).forEach(([category, assets]) => {
      Object.entries(assets).forEach(([assetName, locations]) => {
        locations.forEach((location, index) => {
          flat.push({
            id: location.id || `${assetName}_${index}`,
            assetName,
            category,
            categoryKey: location.categoryKey, // Include actual categoryKey
            x: location.x,
            y: location.y,
            relativeX: location.relativeX,
            relativeY: location.relativeY,
            active: location.active || 0,
            raw: location,
            locationIndex: index,
            deviceLocation: location.deviceLocation, // Include deviceLocation
          })
        })
      })
    })

    const { width, height, offsetX, offsetY, naturalWidth, naturalHeight } = actualImageDimensions

    return flat.map((m, i) => {
      const hasRelative = typeof m.relativeX === "number" && typeof m.relativeY === "number"
      const hasNatural = typeof m.x === "number" && typeof m.y === "number"

      if (!hasRelative && !hasNatural) return null

      // Calculate base position
      const baseLeft = hasRelative
        ? offsetX + (m.relativeX / 100) * width
        : m.x * (naturalWidth ? width / naturalWidth : 1) + offsetX

      const baseTop = hasRelative
        ? offsetY + (1 - m.relativeY / 100) * height
        : m.y * (naturalHeight ? height / naturalHeight : 1) + offsetY

      // Apply zoom compensation
      const left = baseLeft * browserZoom
      const top = baseTop * browserZoom

      // Resolve current active status from realtime state (fallback to mapping value)
      const sanitizedId = sanitizeDocumentId(m.id || m.assetName)
      const statusFromState = activeStatuses[m.id] || activeStatuses[sanitizedId]
      const fallbackActive = statusFromState ? statusFromState.active : m.active || 0
      const deviceAddr =
        assetDeviceData[sanitizedId]?.deviceAddress ||
        m.raw?.deviceAddress ||
        m.deviceAddress
      const currentActive = resolveMarkerActive(
        m.id || sanitizedId,
        deviceAddr,
        fallbackActive,
        fireStatusCache,
      )
      const radarColor = getRadarColor(currentActive)
      const borderColor = getRadarBorderColor(currentActive)
      const dimColor = getDimColor(currentActive)
      const pulseHigh = shouldFireRipple(currentActive)
      const markerTooltip = getAssetMarkerTooltip(
        {
          ...m,
          deviceLocation:
            assetDeviceData[sanitizedId]?.deviceLocation ||
            m.raw?.deviceLocation ||
            m.deviceLocation,
          deviceAddress: deviceAddr,
        },
        fireStatusCache.metaByAssetId,
      )

      return (
        <div
          key={m.id + "-" + m.locationIndex}
          className="absolute z-20 cursor-pointer"
          style={{ left, top, transform: `translate(-50%, -50%) scale(${1 / browserZoom})`, transformOrigin: "center" }}
          onClick={() =>
            handleAssetClick({
              id: m.id,
              assetName: m.assetName,
              category: m.category,
              categoryKey: m.categoryKey, // Pass actual categoryKey
              x: m.x,
              y: m.y,
              relativeX: m.relativeX,
              relativeY: m.relativeY,
            })
          }
          title={markerTooltip}
        >
          {/* Fixed-size container so all bubble layers align to the same center */}
          <div className="relative" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* Dim filled circle background (always present, subtle) */}
            <div
              className="absolute rounded-full"
              style={{
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 44,
                height: 44,
                background: dimColor,
                borderRadius: "50%",
                pointerEvents: "none",
              }}
            />

            {/* Pulsing radar background for high activity only (8-10) */}
            {pulseHigh && (
              <div
                className="absolute rounded-full"
                style={{
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 44,
                  height: 44,
                  background: radarColor,
                  borderRadius: "50%",
                  animation: "radar-pulse 1.8s infinite",
                  opacity: 0.9,
                }}
              />
            )}

            {/* Outer border indicator (centered by flex parent) */}
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#ffffff",
                border: `2px solid ${borderColor}`,
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Asset image (use customImageUrl if available, otherwise use default icon) */}
              {(() => {
                const customUrl =
                  (m.raw && m.raw.customImageUrl) ||
                  (assetDeviceData && assetDeviceData[sanitizedId] && assetDeviceData[sanitizedId].customImageUrl) ||
                  null;
                return (
                  <img
                    src={getIconForCategory(m.category, customUrl)}
                    alt={m.assetName || "asset"}
                    title={markerTooltip}
                    className="w-5 h-5 object-contain rounded-full"
                    onError={handleImageError}
                  />
                )
              })()}
            </div>
          </div>
        </div>
      )
    })
  }

  const getSelectedCommunityInfo = () => {
    if (!selectedCommunity) return null
    return communities.find((c) => c.id === selectedCommunity)
  }

  // Helper function to sanitize document ID to match Firestore format
  const sanitizeDocumentId = (id) => {
    if (!id) return ""
    return id
      .toString()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[\/\\]/g, "_")
      .replace(/[()]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .substring(0, 100)
  }

  // Fetch deviceLocation, deviceAddress, and customImageUrl for all assets from Firestore
  const fetchAssetDeviceData = async (floorPlanName) => {
    if (!selectedBuilding || !floorPlanName) return

    try {
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const assetMappingsRef = collection(
        db,
        buildingNameWithSuffix,
        "floorMaps",
        "floors",
        floorPlanName,
        "assetMappings"
      )
      
      const querySnapshot = await getDocs(assetMappingsRef)
      const deviceDataMap = {}
      
      querySnapshot.forEach((doc) => {
        const data = doc.data()
        // Use document ID as key (it's already sanitized in Firestore)
        deviceDataMap[doc.id] = {
          deviceLocation: data.deviceLocation || "",
          deviceAddress: data.deviceAddress || "",
          customImageUrl: data.customImageUrl || null,
        }
        // Also map by the id field if it exists and is different
        if (data.id && data.id !== doc.id) {
          const sanitizedId = sanitizeDocumentId(data.id)
          if (sanitizedId && sanitizedId !== doc.id) {
            deviceDataMap[sanitizedId] = {
              deviceLocation: data.deviceLocation || "",
              deviceAddress: data.deviceAddress || "",
              customImageUrl: data.customImageUrl || null,
            }
          }
        }
      })
      
      setAssetDeviceData(deviceDataMap)
    } catch (error) {
      console.error("Error fetching device data:", error)
      // Don't show error toast as this is a background operation
    }
  }

  // Handle asset click to open modal
  const handleAssetClick = async (mapping) => {
    if (!selectedBuilding || !selectedFloorPlan) return

    // Check if building status is "construction"
    if (buildingStatus !== "construction") {
      toast({
        title: "Feature Unavailable",
        description: "Asset controls are only available for buildings with 'Construction' status",
        variant: "destructive",
      })
      return
    }

    try {
      // Fetch the asset document from new asset collection structure
      const buildingNameWithSuffix = selectedBuilding + "BuildingDB"
      const assetDocRef = doc(
        db,
        buildingNameWithSuffix,
        "asset",
        mapping.categoryKey, // Use actual categoryKey (fire-life-safety, electrical, etc.)
        mapping.id // id is the buildingAssetId
      )
      
      const assetDoc = await getDoc(assetDocRef)
      
      let assetData = {}
      
      if (assetDoc.exists()) {
        assetData = assetDoc.data()
      } else {
        // Document doesn't exist, use defaults
        assetData = {}
      }

      const installedStatus = assetData.installed !== undefined ? assetData.installed : false
      
      setSelectedAsset({
        ...mapping,
        buildingAssetId: mapping.id, // Store buildingAssetId for updates
        assetCategory: mapping.categoryKey, // Store categoryKey for path building in update functions
        activityStatus: assetData.activityStatus !== undefined ? assetData.activityStatus : mapping.active,
        enabled: assetData.enabled !== undefined ? assetData.enabled : true,
        deviceLocation: assetData.deviceLocation || "",
        deviceAddress: assetData.deviceAddress || "",
        installed: installedStatus,
      })
      setDeviceLocation(assetData.deviceLocation || "")
      setDeviceAddress(assetData.deviceAddress || "")
      setInstalled(installedStatus)
      setIsAssetModalOpen(true)
    } catch (error) {
      console.error("Error fetching asset data:", error)
      toast({
        title: "Error",
        description: "Failed to load asset details",
        variant: "destructive",
      })
    }
  }

  // Update installed status
  const handleUpdateInstalled = async (installedValue) => {
    if (!selectedAsset || !selectedBuilding || !selectedFloorPlan || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update installation status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus !== "construction") {
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
        selectedAsset.assetCategory, // category key (fire-life-safety, electrical, etc.)
        selectedAsset.buildingAssetId // buildingAssetId as document ID
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
    if (!selectedAsset || !selectedBuilding || !selectedFloorPlan || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update asset status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus !== "construction") {
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
        selectedAsset.assetCategory, // category key (fire-life-safety, electrical, etc.)
        selectedAsset.buildingAssetId // buildingAssetId as document ID
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
    if (!selectedAsset || !selectedBuilding || !selectedFloorPlan || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update asset status",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus !== "construction") {
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
        selectedAsset.assetCategory, // category key (fire-life-safety, electrical, etc.)
        selectedAsset.buildingAssetId // buildingAssetId as document ID
      )

      await updateDoc(assetDocRef, {
        enabled: enabled,
      })

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

  // Update device location and address
  const handleUpdateLocation = async () => {
    if (!selectedAsset || !selectedBuilding || !selectedFloorPlan || userRole !== "admin") {
      toast({
        title: "Unauthorized",
        description: "Only admins can update device location",
        variant: "destructive",
      })
      return
    }

    if (buildingStatus !== "construction") {
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
        selectedAsset.assetCategory, // category key (fire-life-safety, electrical, etc.)
        selectedAsset.buildingAssetId // buildingAssetId as document ID
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

  if (!mounted) {
    return null
  }

  return (
    <SidebarProvider>
      <style jsx>{`
        @keyframes radar-pulse {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.8);
          }
          50% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.4);
          }
        }
      `}</style>
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
                  <BreadcrumbPage>Floor Plan Viewer</BreadcrumbPage>
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
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Floor Plan Viewer</h1>
                <p className="text-muted-foreground text-sm md:text-base">
                  Select a community, building and floor plan to view real-time asset activity
                </p>
              </div>
              <div className="flex items-center gap-4">
                {connectionType === "sse" && isConnected && (
                  <div className="flex items-center gap-2 text-green-600">
                    <Wifi className="h-4 w-4" />
                    <span className="text-sm font-medium">Live</span>
                  </div>
                )}
                {connectionType === "polling" && isConnected && (
                  <div className="flex items-center gap-2 text-orange-600">
                    <Wifi className="h-4 w-4" />
                    <span className="text-sm font-medium">Polling</span>
                  </div>
                )}
                {connectionType === "none" && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <WifiOff className="h-4 w-4" />
                    <span className="text-sm font-medium">Offline</span>
                  </div>
                )}
                {lastUpdate && (
                  <span className="text-xs text-muted-foreground">Updated: {lastUpdate.toLocaleTimeString()}</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Community Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="communitySelect">Available Communities</Label>
                  <Select
                    value={selectedCommunity}
                    onValueChange={handleCommunitySelection}
                    disabled={isLoadingCommunities}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingCommunities ? "Loading communities..." : "Select a community"} />
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

                {selectedCommunity && getSelectedCommunityInfo() && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-800">
                        {getSelectedCommunityInfo().communityName}
                      </span>
                      <Badge variant="secondary" className="ml-2">
                        {getSelectedCommunityInfo().totalBuildings} buildings
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Building2 className="h-5 w-5" />
                  Building Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="buildingSelect">Available Buildings</Label>
                  <Select value={selectedBuilding} onValueChange={handleBuildingSelection} disabled={!selectedCommunity}>
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

                {selectedBuilding && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800">Selected: {selectedBuilding}</span>
                      <Badge variant="secondary" className="ml-2">
                        {floorPlans.length} floor plans
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Floor Plan Tiles */}
          {selectedBuilding && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Eye className="h-5 w-5" />
                  Floor Plans
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingFloorPlans ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading floor plans...</span>
                  </div>
                ) : floorPlans.length > 0 ? (
                  <div className="flex flex-wrap gap-4">
                    {floorPlans.map((floorPlan) => {
                      const isSelected = selectedFloorPlan === floorPlan.name
                      return (
                        <button
                          key={floorPlan.name}
                          onClick={() => handleFloorPlanSelection(floorPlan.name)}
                          className={`relative flex flex-col items-center justify-center p-4 border-2 rounded-lg transition-all hover:shadow-md min-w-[120px] ${
                            isSelected
                              ? "border-primary bg-primary/10 shadow-md"
                              : "border-border bg-card hover:border-primary/50"
                          }`}
                          disabled={isLoadingFloorPlans}
                        >
                          {floorPlan.imageUrl ? (
                            <FloorPlanThumbnail
                              imageUrl={floorPlan.imageUrl}
                              alt={floorPlan.floorPlanName || floorPlan.name}
                            />
                          ) : (
                            <div className="w-20 h-20 bg-muted rounded mb-2 flex items-center justify-center">
                              <ImageIcon className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <span className={`text-sm font-medium text-center ${isSelected ? "text-primary" : "text-foreground"}`}>
                            {floorPlan.floorPlanName || floorPlan.name}
                          </span>
                          {isSelected && (
                            <div className="absolute top-2 right-2">
                              <Badge variant="default" className="h-5 w-5 rounded-full p-0 flex items-center justify-center">
                                <CheckCircle className="h-3 w-3" />
                              </Badge>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Eye className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">No floor plans available</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* Acknowledge button for THEMORA building */}
          {selectedBuilding === "THEMORA" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">Building Actions<FaqHelpButton articleId="page-floor-view" /></CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleAckClick}
                  disabled={isAckLoading}
                  className={`w-32 text-white ${
                    ackStatus ? "bg-red-500 hover:bg-red-600" : "bg-green-500 hover:bg-green-600"
                  }`}
                >
                  {isAckLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    "Acknowledge"
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:gap-6 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg flex-1">
                      <ImageIcon className="h-5 w-5" />
                      {floorPlanData ? (
                        <>
                          {floorPlanData.floorPlanName} ({selectedBuilding})
                          {buildingStatus && (
                            <span className="text-sm font-normal text-muted-foreground">
                              - {buildingStatus.charAt(0).toUpperCase() + buildingStatus.slice(1)}
                            </span>
                          )}
                        </>
                      ) : (
                        "Floor Plan"
                      )}
                      {isLoadingFloorPlanData && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                    </CardTitle>
                    {floorPlanData && (
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
                  {isLoadingFloorPlanData ? (
                    <div className="border rounded-lg h-[300px] md:h-[600px] flex items-center justify-center bg-muted/20">
                      <div className="text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">
                          Loading floor plan data...
                        </p>
                      </div>
                    </div>
                  ) : floorPlanData ? (
                    <div
                      ref={mapContainerRef}
                      className={`relative border rounded-lg overflow-hidden bg-gray-50 ${
                        isFullscreen ? "fixed inset-0 z-50 rounded-none border-0" : ""
                      }`}
                    >
                      <img
                        ref={imageRef}
                        src={floorPlanImageUrl || "/placeholder.svg"}
                        alt={floorPlanData.floorPlanName}
                        className="block w-full h-auto max-w-full"
                        onLoad={handleImageLoad}
                        style={{
                          objectFit: "contain",
                          objectPosition: "center",
                          maxHeight: isFullscreen ? "100vh" : isMobile ? "400px" : "600px",
                          touchAction: "manipulation",
                        }}
                      />
                      {renderAssetMappings()}
                      {!imageLoaded && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                          <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-400" />
                        </div>
                      )}
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
                    <div className="border-2 border-dashed rounded-lg h-[300px] md:h-[600px] flex items-center justify-center">
                      <div className="text-center">
                        <ImageIcon className="mx-auto h-12 w-12 text-gray-400" />
                        <p className="mt-4 text-base text-gray-500">Please select a floor plan to view</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5" />
                    {(() => {
                      const activeCount = Object.values(activeStatuses || {}).filter(s => s && Number(s.active) > 0).length;
                      return `ALARM HISTORY${activeCount ? ` • Active: ${activeCount}` : ""}`;
                    })()}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {floorPlanData?.assetMappings && Object.keys(floorPlanData.assetMappings).length > 0 ? (
                    <div className="space-y-4 max-h-[400px] md:max-h-[600px] overflow-y-auto">
                      {Object.entries(floorPlanData.assetMappings).map(([category, assets]) => (
                        <div key={category} className="space-y-2">
                          <div className="flex items-center gap-2 font-medium text-sm border-b pb-1">
                            {/* --- MODIFICATION 4: Use custom icon for category in side list --- */}
                            <img
                              src={getIconForCategory(category, assets.customImageUrl)}
                              alt={category}
                              className="w-5 h-5 object-contain"
                              onError={handleImageError}
                            />
                            <span>{category}</span>
                          </div>
                          <div className="space-y-2 ml-7">
                            {Object.entries(assets).map(([assetName, locations]) =>
                              locations.map((location, index) => {
                                const currentActiveStatus = activeStatuses[location.id]
                                const fallbackActive = currentActiveStatus ? currentActiveStatus.active : location.active || 0
                                // Get deviceLocation from Firestore data
                                const sanitizedId = sanitizeDocumentId(location.id || assetName)
                                const deviceData = assetDeviceData[sanitizedId] || assetDeviceData[location.id] || {}
                                const displayName = deviceData.deviceLocation || location.deviceLocation || assetName
                                const deviceAddr =
                                  deviceData.deviceAddress ||
                                  location.deviceAddress ||
                                  location.raw?.deviceAddress
                                const currentActive = resolveMarkerActive(
                                  location.id || sanitizedId,
                                  deviceAddr,
                                  fallbackActive,
                                  fireStatusCache,
                                )
                                const statusDisplay = getFireStatusDisplay(currentActive)
                                return (
                                  <div key={location.id} className="p-2 bg-muted rounded text-xs">
                                    <div className="flex justify-between items-center font-medium">
                                      <span>{displayName} #{index + 1}</span>
                                      <span className="text-muted-foreground">({location.x}, {location.y})</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: statusDisplay.color }}
                                      />
                                      <span style={{ color: statusDisplay.color, fontWeight: 500 }}>
                                        {statusDisplay.label}
                                      </span>
                                    </div>
                                  </div>
                                )
                              }),
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <MapPin className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-500">No assets mapped</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Footer row: User Role | Time and date | logo */}
          <div className="flex items-center justify-between text-sm text-muted-foreground px-4 py-3 border-t">
            <div>{userRole || "User"}</div>
            <div>{new Date().toLocaleString()}</div>
            <div><img src="/logo.png" alt="Logo" className="h-6 w-auto" /></div>
          </div>
        </div>
      </SidebarInset>

      {/* Asset Control Modal */}
      <Dialog open={isAssetModalOpen} onOpenChange={setIsAssetModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5" />
              Asset Control - {selectedAsset?.assetName}
            </DialogTitle>
            <DialogDescription>
              {selectedAsset?.category} at position ({selectedAsset?.naturalX}, {selectedAsset?.naturalY})
            </DialogDescription>
          </DialogHeader>

          {userRole === "admin" && buildingStatus === "construction" ? (
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
                        : "bg-gray-200 hover:bg-gray-300"
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
                        : "bg-gray-200 hover:bg-gray-300"
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
                        : "bg-gray-200 hover:bg-gray-300"
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
                        : "bg-gray-200 hover:bg-gray-300"
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
                    : "Asset controls are only available for buildings with 'Construction' status. Current building status: " + (buildingStatus || "Unknown")}
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssetModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}