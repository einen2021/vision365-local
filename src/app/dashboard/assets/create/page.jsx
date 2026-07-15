"use client"

import { useState, useRef, useEffect } from "react"
import { DashboardHeader } from "@/components/dashboard-header";
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Plus,
  Minus,
  Building2,
  Package,
  Settings,
  CheckCircle,
  Loader2,
  Users,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import secureLocalStorage from "react-secure-storage"
import { parseStoredUser } from "@/lib/sessionUser"
import * as XLSX from "xlsx"
import dynamic from "next/dynamic"
import { useAppData } from "@/hooks/useAppData"
import { db } from "@/config/firebase"
import { collection, getDocs, addDoc, setDoc, doc, getDoc, updateDoc, writeBatch } from "firebase/firestore"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"

// Template data from fire_panel_boq_asset.json (NaN entries filtered out)
const TEMPLATE_DATA = {
  categories: [
    "FIRE ALARM",
    "CENTRAL BATTERY SYSTEM",
    "CENTRAL MONITORING SYSTEM",
    "SELF CONTAINED LIGHTS",
    "FIRE FIGHTING",
    "PAVA"
  ],
  assets: [
    { category: "FIRE ALARM", name: "FIRE ALARM CONTROL PANEL" },
    { category: "FIRE ALARM", name: "FIRE ALARM REPEATER PANEL" },
    { category: "FIRE ALARM", name: "MASTER FIRE PANEL" },
    { category: "FIRE ALARM", name: "FIRE ALARM GRAPHICS" },
    { category: "FIRE ALARM", name: "PHOTO ELECTRIC SMOKE SENSOR" },
    { category: "FIRE ALARM", name: "HEAT SENSOR " },
    { category: "FIRE ALARM", name: "FIRE MEN TELEPHONE JACK" },
    { category: "FIRE ALARM", name: "MULTI SENSOR (SMOKE/HEAT)" },
    { category: "FIRE ALARM", name: "VOID SMOKE SENSOR" },
    { category: "FIRE ALARM", name: "CEILING MOUNTED EVACUATION SPEAKER" },
    { category: "FIRE ALARM", name: "CEILING MOUNTED EVACUATION SPEAKER(W/P)" },
    { category: "FIRE ALARM", name: "WALL MOUNTED FIRE ALARM SOUNDER WITH FLASHER" },
    { category: "FIRE ALARM", name: "WALL MOUNTED FIRE ALARM SOUNDER(W/P)" },
    { category: "FIRE ALARM", name: "INTERFACE UNIT" },
    { category: "FIRE ALARM", name: "DOUBLE ACTION ADDRESSABLE PULLSTATION" },
    { category: "FIRE ALARM", name: "DOUBLE ACTION ADDRESSABLE PULLSTATION(W/P)" },
    { category: "FIRE ALARM", name: "WALL MOUNTED FIRE ALARM SOUNDER" },
    { category: "FIRE ALARM", name: "WALL MOUNTED STROBE LIGHT" },
    { category: "FIRE ALARM", name: "WALL MOUNTED STROBE LIGHT(W/P)" },
    { category: "FIRE ALARM", name: "WALL MOUNTED PHOTO ELECTRIC SMOKE SENSOR" },
    { category: "FIRE ALARM", name: "WALL MOUNTED FIRE SPEAKER DECORATIVE TYPE" },
    { category: "FIRE ALARM", name: "MONITOR MODULE" },
    { category: "FIRE ALARM", name: "CONTROL MODULE" },
    { category: "FIRE ALARM", name: "FIRE PANEL ENCLOSURE" },
    { category: "FIRE ALARM", name: "FIRE TELEPHONE ENCLOSURE" },
    { category: "FIRE ALARM", name: "FIRE TELEPHONE HANDSET" },
    { category: "FIRE ALARM", name: "BACKBOX" },
    { category: "FIRE ALARM", name: "2.5 MM FIRE CABLE" },
    { category: "FIRE ALARM", name: "1.5 MM FIRE CABLE" },
    { category: "FIRE ALARM", name: "BATTERY" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EMERGENCY LIGHT, NON-MAINTAINED" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EMERGENCY LIGHT, NON-MAINTAINED(W/P)" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EMERGENCY LIGHT NON MAINTAINED,DECORATIVE TYPE" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EXIT LIGHT, MAINTAINED." },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EXIT LIGHT, MAINTAINED(W/P)" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EXIT LIGHT, MAINTAINED, WITH DOUBLE SIDE HANGING ARROWS" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LED EXIT LIGHT, MAINTAINED, WITH DOUBLE SIDE HANGING ARROWS(W/P)" },
    { category: "CENTRAL BATTERY SYSTEM", name: "CENTRAL BATTERY PANEL" },
    { category: "CENTRAL BATTERY SYSTEM", name: "CENTRAL BATTERY SUB PANEL" },
    { category: "CENTRAL BATTERY SYSTEM", name: "CENTRAL BATTERY GRAPHICS" },
    { category: "CENTRAL BATTERY SYSTEM", name: "CHANGE OVER MODULE" },
    { category: "CENTRAL BATTERY SYSTEM", name: "LIGHT ADDRESS MODULE" },
    { category: "CENTRAL BATTERY SYSTEM", name: "SUB CIRCUIT MONITORING MODULE" },
    { category: "CENTRAL BATTERY SYSTEM", name: "BATTERY" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EMERGENCY LIGHT, NON-MAINTAINED" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EMERGENCY LIGHT, NON-MAINTAINED(W/P)" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EMERGENCY LIGHT NON MAINTAINED,DECORATIVE TYPE" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EXIT LIGHT, MAINTAINED." },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EXIT LIGHT, MAINTAINED(W/P)" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EXIT LIGHT, MAINTAINED, WITH DOUBLE SIDE HANGING ARROWS" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LED EXIT LIGHT, MAINTAINED, WITH DOUBLE SIDE HANGING ARROWS(W/P)" },
    { category: "CENTRAL MONITORING SYSTEM", name: "CENTRAL MONITORING PANEL" },
    { category: "CENTRAL MONITORING SYSTEM", name: "CENTRAL  MONITORING PANEL MODULE" },
    { category: "CENTRAL MONITORING SYSTEM", name: "CENTRAL  MONITORING GRAPHICS" },
    { category: "CENTRAL MONITORING SYSTEM", name: "LIGHT BATTERY " },
    { category: "SELF CONTAINED LIGHTS", name: "EMERGENCY LIGHT, NON-MAINTAINED" },
    { category: "SELF CONTAINED LIGHTS", name: "EMERGENCY LIGHT, NON-MAINTAINED(W/P)" },
    { category: "SELF CONTAINED LIGHTS", name: "LED EXIT LIGHT, MAINTAINED." },
    { category: "SELF CONTAINED LIGHTS", name: "LED EXIT LIGHT, MAINTAINED(W/P)" },
    { category: "FIRE FIGHTING", name: "Pendant sprinkler" },
    { category: "FIRE FIGHTING", name: "Upright sprinkler" },
    { category: "FIRE FIGHTING", name: "Side wall sprinklers" },
    { category: "FIRE FIGHTING", name: "Fire blankets" },
    { category: "FIRE FIGHTING", name: "DCP " },
    { category: "FIRE FIGHTING", name: "Co2 " },
    { category: "FIRE FIGHTING", name: "Co2 Wheeled" },
    { category: "FIRE FIGHTING", name: "Fire hose reels cabinet " },
    { category: "FIRE FIGHTING", name: "Zone control valve " },
    { category: "FIRE FIGHTING", name: "Breeching inlet 2 way " },
    { category: "FIRE FIGHTING", name: "Breeching inlet 4 way " },
    { category: "FIRE FIGHTING", name: "Automatic air release valve " },
    { category: "FIRE FIGHTING", name: "IV 25MM 4NOS" },
    { category: "FIRE FIGHTING", name: "Diesel Pump" },
    { category: "FIRE FIGHTING", name: "Jockey pump " },
    { category: "FIRE FIGHTING", name: "Electrical Pump" },
    { category: "PAVA", name: "CEILING SPEAKER" },
    { category: "PAVA", name: "WALL MOUNT SPEAKER" },
    { category: "PAVA", name: "AUDIO CONTROLLER" },
    { category: "PAVA", name: "AMPLIFIER" },
    { category: "PAVA", name: "MICROPHONE" },
    { category: "PAVA", name: "BATTERY" },
    { category: "PAVA", name: "AMPLIFIER CARDS" }
  ]
}

// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

// Asset categories with icons and keywords
const ASSET_CATEGORIES = {
  "fire-life-safety": {
    name: "Fire & Life Safety Systems (FLS)",
    icon: "🧯",
    keywords: ["fire", "alarm", "smoke", "heat", "evacuation", "emergency lighting", "sprinkler", "fighting"],
  },
  electrical: {
    name: "Electrical Systems",
    icon: "⚡",
    keywords: ["electrical", "power", "distribution", "panel", "transformer"],
  },
  hvac: {
    name: "HVAC Systems",
    icon: "❄",
    keywords: ["hvac", "heating", "ventilation", "air conditioning", "cooling", "duct"],
  },
  plumbing: {
    name: "Plumbing & Drainage Systems",
    icon: "💧",
    keywords: ["plumbing", "drainage", "water", "pipe", "pump", "tank"],
  },
  elv: {
    name: "ELV (Extra-Low Voltage) Systems",
    icon: "🔌",
    keywords: ["elv", "low voltage", "communication", "data", "network"],
  },
  security: {
    name: "Security Systems",
    icon: "🔒",
    keywords: ["security", "access", "cctv", "surveillance", "alarm"],
  },
  "vertical-transport": {
    name: "Vertical Transportation",
    icon: "🛗",
    keywords: ["elevator", "lift", "escalator", "vertical", "transport"],
  },
  lighting: {
    name: "Lighting Systems",
    icon: "💡",
    keywords: ["lighting", "led", "lamp", "fixture", "illumination"],
  },
  bms: {
    name: "Building Management & Automation (BMS/IBMS)",
    icon: "🧠",
    keywords: ["bms", "ibms", "automation", "control", "management", "monitoring"],
  },
  landscaping: {
    name: "Landscaping & Irrigation",
    icon: "🌳",
    keywords: ["landscaping", "irrigation", "garden", "sprinkler", "landscape"],
  },
  additional: {
    name: "Optional Additional Asset Groups",
    icon: "📦",
    keywords: ["additional", "optional", "misc", "other"],
  },
}

/** Panel type is SHIELD OMEGA X only; BIM Excel + built-in BOQ template follow FIRE ALARM filter unless file is SHIELD export */
const SHIELD_PANEL_TYPE_VALUE = "shield-omega-x"
const SHIELD_OMEGA_X_BRAND = "SHIELD OMEGA X"

const BIM_PANEL_TYPES = [{ value: SHIELD_PANEL_TYPE_VALUE, label: SHIELD_OMEGA_X_BRAND }]

/** BOQ categories for SHIELD OMEGA X: FIRE ALARM rows from built-in template only */
function getBoqTemplateCategoryFilter() {
  return new Set(["FIRE ALARM"])
}

/** BIM excel rows: keep SHIELD-imported points, otherwise only FIRE ALARM (panel type is SHIELD OMEGA X only). */
function filterBimExcelDevices(devices) {
  if (!devices?.length) return devices || []
  const list = devices || []
  const tagged = list.filter((d) => d.importSource === SHIELD_PANEL_TYPE_VALUE)
  return tagged.length ? tagged : list.filter((d) => d.mainCategory === "FIRE ALARM")
}

/** SHEILD Omega X / S‑Explorer multi-loop FACP exports (BLOCKG … AllLoops-style). Parses every sheet except Summary-like tabs. */
function shieldRowNormalizedMap(row) {
  /** @type {Record<string,string>} */
  const m = {}
  for (const k of Object.keys(row)) {
    const nk = String(k)
      .trim()
      .replace(/\s+/g, "")
      .toLowerCase()
    if (!nk || nk.startsWith("__")) continue
    const v = row[k]
    m[nk] = v !== undefined && v !== null ? String(v).trim() : ""
  }
  return m
}

function shieldPick(normMap, keys) {
  for (const k of keys) {
    const v = normMap[k]
    if (v) return v
  }
  return ""
}

/** Typical SHIELD Omega X point addresses like "001.00"; also panel labels e.g. "FACP1", "L01D001". */
function isLikelyShieldPointAddress(addr) {
  const s = String(addr ?? "").trim()
  if (!s || s.length > 48) return false
  if (/\d+\.\d+(?:\([^)]*\))?/.test(s) || /^\d{1,6}$/.test(s)) return true
  // Alphanumeric loop / panel tags (common in FACP schedules, duplicated sheets, etc.)
  if (/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s)) return true
  return false
}

function parseShieldOmegaXWorkbook(workbook) {
  const devices = []
  if (!workbook?.SheetNames?.length) return devices

  for (const sheetName of workbook.SheetNames) {
    const snTrim = sheetName.trim()
    if (/^summary$/i.test(snTrim)) continue

    const ws = workbook.Sheets[sheetName]
    if (!ws) continue

    const rawObjects = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false })
    if (!rawObjects.length) continue

    rawObjects.forEach((rowObj) => {
      const nm = shieldRowNormalizedMap(rowObj)

      let address =
        shieldPick(nm, ["address", "paneladdress", "panelpoint", "devaddr", "loopaddress"]) || ""
      if (!address) return

      if (/^address$/i.test(address)) return // header echo

      if (!isLikelyShieldPointAddress(address)) return

      const deviceType =
        shieldPick(nm, ["devicetype", "device", "type", "equipment", "equipmenttype"]) || ""
      if (!deviceType || /^device\s*type$/i.test(deviceType)) return

      const subType = shieldPick(nm, ["subtype", "subtypecode", "devsubtype"]) || ""

      const zone = shieldPick(nm, ["zone", "zonenumber", "z"]) || ""

      // Exports can be either:
      // 1) single "Location Text" column, or
      // 2) split "Location" + "Text" columns
      const locationTextSingle =
        shieldPick(nm, [
          "locationtext",
          "locationdescription",
          "devicelocationtext",
          "description",
          "devicelocation",
          "devlocation",
        ]) || ""
      const locationPart = shieldPick(nm, ["location"]) || ""
      const textPart = shieldPick(nm, ["text"]) || ""
      const locationText = locationTextSingle || [locationPart, textPart].filter(Boolean).join(" ").trim()

      const checked = shieldPick(nm, ["checked", "verified", "tested"])

      const subLabel = String(subType).trim()
      const deviceTypeLabel =
        subLabel && !deviceType.includes(subLabel) ? `${deviceType} (${subLabel})` : deviceType

      const loopKey = sheetName.replace(/\s+/g, "").replace(/\W+/g, "_")
      const addrKey = address.replace(/\s+/g, "").replace(/\./g, "_")
      const deviceAddress = `${loopKey}_${addrKey}`

      const locParts = [locationText, zone ? `Zone ${zone}` : "", sheetName ? `(${sheetName})` : ""].filter(Boolean)
      const deviceLocation = locParts.join(" · ")
      // BOQ `name` / Firestore `assetName` mirror installation location (device type kept on shieldDeviceTypeRaw)
      const name = deviceLocation.trim() || deviceTypeLabel.trim()

      devices.push({
        name,
        deviceAddress,
        deviceLocation,
        deviceType: deviceTypeLabel,
        categoryKey: "fire-life-safety",
        assetCategory: "FIRE AND LIFE SAFETY",
        mainCategory: "FIRE ALARM",
        coordinates: null,
        importSource: SHIELD_PANEL_TYPE_VALUE,
        panelBrand: SHIELD_OMEGA_X_BRAND,
        loopSheet: sheetName,
        shieldAddress: address,
        shieldZone: zone || undefined,
        shieldSubType: subLabel || undefined,
        shieldDeviceTypeRaw: deviceType,
        shieldDeviceTypeLabel: deviceTypeLabel,
        ...(checked ? { shieldChecked: checked } : {}),
      })
    })    
  }

  return devices
}

function bimPanelTypeLabel(panelTypeValue) {
  return BIM_PANEL_TYPES.find((p) => p.value === panelTypeValue)?.label || panelTypeValue
}

export default function AssetCreatePage() {
  const [mounted, setMounted] = useState(false)
  const [buildingName, setBuildingName] = useState("")
  const [selectedBuildingId, setSelectedBuildingId] = useState("")
  const [selectedCommunityId, setSelectedCommunityId] = useState("")
  const { communities, isLoadingCommunities, isReady } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [buildings, setBuildings] = useState([])
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [previewData, setPreviewData] = useState([])
  const [uploadedAssetDetails, setUploadedAssetDetails] = useState({}) // key -> array of rows from excel
  const [excelDevices, setExcelDevices] = useState([]) // flat array of parsed rows from new-format excel
  const [mainCategories, setMainCategories] = useState([])
  const [assetNames, setAssetNames] = useState([])
  const [categoryMapping, setCategoryMapping] = useState({})
  const [assetCounts, setAssetCounts] = useState({})
  const [existingAssetCounts, setExistingAssetCounts] = useState({}) // Track existing assets
  const [existingAssetGroups, setExistingAssetGroups] = useState({}) // assetName -> { count, mainCategory, categoryKey, communityId? }
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [buildingTotalCount, setBuildingTotalCount] = useState(null)
  const [step, setStep] = useState(1) // 1: Upload, 2: Configure, 3: Review
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newAssetName, setNewAssetName] = useState("")
  const [newAssetCategory, setNewAssetCategory] = useState("")
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [showAddAsset, setShowAddAsset] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState("")
  const [bimPanelType, setBimPanelType] = useState(SHIELD_PANEL_TYPE_VALUE)
  const [uploadedAssetsList, setUploadedAssetsList] = useState([])
  const [selectedUploadedAssetIds, setSelectedUploadedAssetIds] = useState([])
  const [isLoadingUploadedAssets, setIsLoadingUploadedAssets] = useState(false)
  const panelExcelInputRef = useRef(null)
  const { toast } = useToast()

  /** Community + Building must be chosen before template / BIM / Panel Excel flows */
  const locationReady = Boolean(selectedCommunityId && selectedBuildingId)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load building summary total when buildingName changes
  useEffect(() => {
    let mounted = true
    const loadSummary = async () => {
      if (!buildingName) {
        setBuildingTotalCount(null)
        return
      }
      try {
        const summaryRef = doc(db,buildingName+"BuildingDB", "buildingSummary")
        const snap = await getDoc(summaryRef)
        if (snap.exists() && mounted) {
          const data = snap.data() || {}
          setBuildingTotalCount(data.totalAssetsCount ?? data.totalAssets ?? null)
        } else {
          setBuildingTotalCount(null)
        }
      } catch (err) {
        console.error("Error loading building summary:", err)
        setBuildingTotalCount(null)
      }
    }
    loadSummary()
    return () => { mounted = false }
  }, [buildingName])

  const fetchUploadedAssetsList = async () => {
    setIsLoadingUploadedAssets(true)
    try {
      const snapshot = await getDocs(collection(db, "AssetsList"))
      const assets = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }))
      setUploadedAssetsList(assets)
    } catch (error) {
      console.error("Error loading uploaded assets:", error)
      setUploadedAssetsList([])
      toast({
        title: "Error",
        description: "Failed to load assets from Upload Assets",
        variant: "destructive",
      })
    } finally {
      setIsLoadingUploadedAssets(false)
    }
  }

  useEffect(() => {
    if (!buildingName) {
      setUploadedAssetsList([])
      setSelectedUploadedAssetIds([])
      return
    }
    fetchUploadedAssetsList()
  }, [buildingName])

  const toggleUploadedAssetSelection = (assetId, checked) => {
    setSelectedUploadedAssetIds((prev) => {
      if (checked) {
        return prev.includes(assetId) ? prev : [...prev, assetId]
      }
      return prev.filter((id) => id !== assetId)
    })
  }

  const toggleSelectAllUploadedAssets = (checked) => {
    if (!checked) {
      setSelectedUploadedAssetIds([])
      return
    }
    setSelectedUploadedAssetIds(uploadedAssetsList.map((asset) => asset.id))
  }

  const assignSelectedUploadedAssetsToBuilding = async () => {
    if (selectedUploadedAssetIds.length === 0) return 0

    const now = new Date().toISOString()
    const batch = writeBatch(db)

    selectedUploadedAssetIds.forEach((assetDocId) => {
      const docRef = doc(db, "AssetsList", assetDocId)
      batch.update(docRef, {
        building: buildingName,
        buildingName,
        communityId: selectedCommunityId,
        updatedAt: now,
      })
    })

    await batch.commit()
    return selectedUploadedAssetIds.length
  }

  const handleCommunitySelect = (communityId) => {
    setSelectedCommunityId(communityId)
    setSelectedBuildingId("") // Reset building selection
    setBuildingName("")
    setSelectedUploadedAssetIds([])

    const selectedCommunity = communities.find(community => community.id === communityId)
    if (selectedCommunity && selectedCommunity.buildings) {
      const formattedBuildings = selectedCommunity.buildings.map((building) => ({
        id: building,
        name: building,
        _id: building
      }))
      setBuildings(formattedBuildings)
    } else {
      setBuildings([])
    }
  }

  useEffect(() => {
    if (!isReady || communities.length === 0 || selectedCommunityId) return
    const first = communities[0]
    if (first?.id) handleCommunitySelect(first.id)
  }, [isReady, communities, selectedCommunityId])

  // Auto-categorize based on keywords
  const suggestCategory = (categoryName, assetName) => {
    const searchText = `${categoryName} ${assetName}`.toLowerCase()

    for (const [key, category] of Object.entries(ASSET_CATEGORIES)) {
      if (category.keywords.some((keyword) => searchText.includes(keyword))) {
        return key
      }
    }
    return "additional"
  }

  // Asset categories are statically defined in ASSET_CATEGORIES constant above

  const handleBuildingSelect = (buildingId) => {
    setSelectedBuildingId(buildingId)
    setSelectedUploadedAssetIds([])
    const selectedBuilding = buildings.find(building => 
      building.id === buildingId || building._id === buildingId
    )
    if (selectedBuilding) {
      setBuildingName(selectedBuilding.name || selectedBuilding.buildingName || selectedBuilding.id || "")
    }
  }

  // Fetch existing assets from Firestore for the selected building
  const fetchExistingAssets = async (buildingName) => {
    if (!buildingName) return { counts: {}, groups: {} }

    const existingCounts = {}
    const existingGroups = {}
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

    try {
      // Query each category collection
      const buildingDbName = `${buildingName}BuildingDB`
      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(db, buildingDbName, "asset", categoryKey)
          const categorySnapshot = await getDocs(categoryCollection)

          categorySnapshot.forEach((docSnap) => {
            const data = docSnap.data() || {}
            const assetName = data.assetName || data.originalAssetId || docSnap.id
            if (assetName) {
              // Count existing instances of this asset
              existingCounts[assetName] = (existingCounts[assetName] || 0) + 1
              if (!existingGroups[assetName]) {
                existingGroups[assetName] = {
                  count: 0,
                  mainCategory: data.mainCategory || "EXISTING",
                  categoryKey: data.categoryKey || categoryKey,
                  communityId: String(data.communityId || "").trim(),
                }
              } else if (!existingGroups[assetName].communityId && data.communityId) {
                existingGroups[assetName].communityId = String(data.communityId).trim()
              }
              existingGroups[assetName].count += 1
            }
          })
        } catch (error) {
          // Category collection might not exist, continue to next
          console.warn(`Category ${categoryKey} not found or error:`, error)
        }
      }
    } catch (error) {
      console.error("Error fetching existing assets:", error)
    }

    return { counts: existingCounts, groups: existingGroups }
  }

  const loadTemplate = async () => {
    // Check if community and building are selected
    if (!selectedCommunityId) {
      toast({
        title: "Community Required",
        description: "Please select a community before loading template",
        variant: "destructive",
      })
      return
    }

    if (!selectedBuildingId) {
      toast({
        title: "Building Required",
        description: "Please select a building before loading template",
        variant: "destructive",
      })
      return
    }

    // Reset current data
    setPreviewData([])
    setMainCategories([])
    setAssetNames([])
    setCategoryMapping({})
    setAssetCounts({})
    setExistingAssetCounts({})
    setUploadSuccess(false)
    setIsLoading(true)

    try {
      // Fetch existing assets first
      const existingData = await fetchExistingAssets(buildingName)
      setExistingAssetCounts(existingData.counts)
      setExistingAssetGroups(existingData.groups)

      // Parse the template data
      const categoryFilter = getBoqTemplateCategoryFilter()
      const templateAssets = TEMPLATE_DATA.assets.filter((asset) => categoryFilter.has(asset.category))

      if (templateAssets.length === 0) {
        toast({
          title: "No BOQ rows for this panel type",
          description: "No matching categories in the built-in BOQ for SHIELD OMEGA X (FIRE ALARM).",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      const parsedData = []
      const categories = new Set()
      const assets = new Set()

      templateAssets.forEach((asset) => {
        categories.add(asset.category)
        assets.add(asset.name)
        parsedData.push({
          mainCategory: asset.category,
          assetName: asset.name,
        })
      })

       setPreviewData(parsedData) // Show all assets
       setMainCategories(Array.from(categories))
       setAssetNames(Array.from(assets))
       
       // Set first category as selected by default
       setSelectedCategory(Array.from(categories)[0] || "")

       // Initialize category mapping - Set FLS to first category by default
       const initialMapping = {
         FLS: Array.from(categories)[0] || ""
       }
       setCategoryMapping(initialMapping)

      // Initialize asset counts using unique keys (category + asset name)
      const initialCounts = {}
      parsedData.forEach((item) => {
        const key = getAssetKey(item.mainCategory, item.assetName)
        initialCounts[key] = 0
      })
      // Allow incrementing existing BOQ assets not present in template
      Object.keys(existingData.groups).forEach((assetName) => {
        const inTemplate = parsedData.some((item) => item.assetName === assetName)
        if (!inTemplate) {
          const key = getAssetKey("EXISTING", assetName)
          initialCounts[key] = 0
        }
      })
      setAssetCounts(initialCounts)

      setStep(2) // Move to configuration step
      
      toast({
        title: "Template Loaded",
        description: `Panel type: ${bimPanelTypeLabel(bimPanelType)} — ${categories.size} categories, ${assets.size} assets.`,
      })
    } catch (error) {
      console.error("Error loading template:", error)
      toast({
        title: "Error",
        description: "Failed to load template data.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const commitImportedDevices = (usedDevices, toastTitle = "Excel Uploaded") => {
    const categories = new Set()
    const assets = new Set()
    const parsedDataMap = new Map()
    const counts = {}

    usedDevices.forEach((d) => {
      // For SHIELD imports, group BOQ rows by device type (not per-location name).
      const groupedAssetName =
        d.importSource === SHIELD_PANEL_TYPE_VALUE && d.deviceType
          ? String(d.deviceType).trim()
          : d.name
      const key = getAssetKey(d.mainCategory, groupedAssetName)
      categories.add(d.mainCategory)
      assets.add(groupedAssetName)
      if (!parsedDataMap.has(key)) {
        parsedDataMap.set(key, { mainCategory: d.mainCategory, assetName: groupedAssetName })
      }
      counts[key] = (counts[key] || 0) + 1
    })
    const parsedData = Array.from(parsedDataMap.values())

    setExcelDevices(usedDevices)
    setPreviewData(parsedData)
    setMainCategories(Array.from(categories))
    setAssetNames(Array.from(assets))
    setCategoryMapping({ FLS: Array.from(categories)[0] || "" })
    setAssetCounts(counts)
    setUploadedAssetDetails({})
    setStep(2)
    toast({
      title: toastTitle,
      description: `Panel type: ${bimPanelTypeLabel(bimPanelType)} — ${usedDevices.length} device record${usedDevices.length !== 1 ? "s" : ""} (FA: ${usedDevices.filter((d) => d.mainCategory === "FIRE ALARM").length}, FF: ${usedDevices.filter((d) => d.mainCategory === "FIRE FIGHTING").length}, HVAC: ${usedDevices.filter((d) => d.mainCategory === "HVAC").length})`,
    })
  }

  // Handle excel upload: new format with GlobalId, Name, FA_Device_Address, FF_Device_Address, HVAC_Device_Address, X_m, Y_m, Z_m
  const handleExcelFile = async (file) => {
    if (!file) return
    try {
      setIsLoading(true)
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array" })
      const firstSheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[firstSheetName]
      const raw = XLSX.utils.sheet_to_json(worksheet, { defval: "" })

      // New column format:
      // GlobalId, Name, FA_Device_Address, FF_Device_Address, HVAC_Device_Address,
      // FA_DeviceLocation, FF_DeviceLocation, HVAC_DeviceLocation, X_m, Y_m, Z_m
      const devices = []

      raw.forEach((row) => {
        const globalId     = String(row.GlobalId || row.globalId || row.global_id || "").trim()
        const name         = String(row.Name || row.name || "").trim()
        const faAddress    = String(row.FA_Device_Address || row.FA_DeviceAddress || "").trim()
        const ffAddress    = String(row.FF_Device_Address || row.FF_DeviceAddress || "").trim()
        const hvacAddress  = String(row.HVAC_Device_Address || row.HVAC_DeviceAddress || "").trim()
        const faLocation   = String(row.FA_DeviceLocation || row.FA_Device_Location || "").trim()
        const ffLocation   = String(row.FF_DeviceLocation || row.FF_Device_Location || "").trim()
        const hvacLocation = String(row.HVAC_DeviceLocation || row.HVAC_Device_Location || "").trim()
        const xM           = parseFloat(row.X_m ?? row.x_m ?? "")
        const yM           = parseFloat(row.Y_m ?? row.y_m ?? "")
        const zM           = parseFloat(row.Z_m ?? row.z_m ?? "")

        const coordinates = (
          Number.isFinite(xM) && Number.isFinite(yM) && Number.isFinite(zM)
        ) ? { x: xM, y: yM, z: zM } : null

        // FA row → fire-life-safety / FIRE ALARM
        if (faAddress) {
          devices.push({
            globalId,
            name: name || faAddress,
            deviceAddress: faAddress,
            deviceLocation: faLocation || "",
            categoryKey: "fire-life-safety",
            assetCategory: "FIRE AND LIFE SAFETY",
            mainCategory: "FIRE ALARM",
            coordinates,
          })
        }

        // FF row → fire-life-safety / FIRE FIGHTING
        if (ffAddress) {
          devices.push({
            globalId,
            name: name || ffAddress,
            deviceAddress: ffAddress,
            deviceLocation: ffLocation || "",
            categoryKey: "fire-life-safety",
            assetCategory: "FIRE AND LIFE SAFETY",
            mainCategory: "FIRE FIGHTING",
            coordinates,
          })
        }

        // HVAC row → hvac
        if (hvacAddress) {
          devices.push({
            globalId,
            name: name || hvacAddress,
            deviceAddress: hvacAddress,
            deviceLocation: hvacLocation || "",
            categoryKey: "hvac",
            assetCategory: "HVAC SYSTEM",
            mainCategory: "HVAC",
            coordinates,
          })
        }
      })

      const devicesFiltered = filterBimExcelDevices(devices)

      if (devices.length === 0) {
        toast({
          title: "No Devices Found",
          description:
            "No rows with FA_Device_Address, FF_Device_Address or HVAC_Device_Address were found. Please check your Excel columns.",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      if (devicesFiltered.length === 0) {
        toast({
          title: "No rows for this panel type",
          description: `The spreadsheet has ${devices.length} mapped row(s), but none are FIRE ALARM rows for ${bimPanelTypeLabel(bimPanelType)}.`,
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      const usedDevices = devicesFiltered
      commitImportedDevices(usedDevices, "Excel Uploaded")
    } catch (err) {
      console.error("Error parsing excel:", err)
      toast({
        title: "Error",
        description: "Failed to parse Excel file",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  /** SHIELD OMEGA X S‑Explorer multi-sheet panel export (only supported panel type). */
  const handlePanelExcelFile = async (file) => {
    if (!file) return
    try {
      setIsLoading(true)
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array" })

      const shieldDevices = parseShieldOmegaXWorkbook(workbook)
      if (shieldDevices.length === 0) {
        toast({
          title: "No SHIELD OMEGA X devices found",
          description:
            "Expected S‑Explorer / Shield export: one sheet per loop with columns Address, Device Type, Sub Type, Zone, Location Text (Summary sheet is skipped). Other sheets with the same columns are also read.",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      commitImportedDevices(
        shieldDevices,
        `${SHIELD_OMEGA_X_BRAND} — Panel Excel uploaded (${shieldDevices.length} points)`
      )
    } catch (err) {
      console.error("Error parsing panel excel:", err)
      toast({
        title: "Error",
        description: "Failed to parse panel Excel file",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Generate unique key for asset (category + asset name)
  const getAssetKey = (category, assetName) => {
    return `${category}|||${assetName}`
  }

  // Parse asset key back to category and name
  const parseAssetKey = (key) => {
    const [category, assetName] = key.split('|||')
    return { category, assetName }
  }

  const updateAssetCount = (assetKey, increment) => {
    setAssetCounts((prev) => ({
      ...prev,
      [assetKey]: Math.max(0, (prev[assetKey] || 0) + increment),
    }))
  }

  const handleDirectCountChange = (assetKey, value) => {
    // Parse the input value and ensure it's at least 0
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue >= 0) {
      setAssetCounts((prev) => ({
        ...prev,
        [assetKey]: numValue,
      }))
    }
  }

  // BOQ table displays total (existing + increment), but we store only increment
  const getDisplayedCount = (assetKey, existingCount = 0) => {
    return (assetCounts[assetKey] || 0) + existingCount
  }

  const adjustDisplayedCount = (assetKey, delta, existingCount = 0) => {
    setAssetCounts((prev) => {
      const currentIncrement = prev[assetKey] || 0
      const currentDisplayed = currentIncrement + existingCount
      const nextDisplayed = Math.max(existingCount, currentDisplayed + delta)
      return {
        ...prev,
        [assetKey]: Math.max(0, nextDisplayed - existingCount),
      }
    })
  }

  const handleDisplayedCountChange = (assetKey, value, existingCount = 0) => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue >= existingCount) {
      setAssetCounts((prev) => ({
        ...prev,
        [assetKey]: Math.max(0, numValue - existingCount),
      }))
    }
  }

  const generateBuildingAssetID = (buildingName, assetName, index) => {
    // Normalize building name and asset name
    // Remove special characters and replace spaces/punctuation with hyphens
    const buildingPart = buildingName
      .trim()
      .toUpperCase()
      .replace(/[,./()]/g, "") // Remove commas, dots, slashes, parentheses
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    
    const assetPart = assetName
      .trim()
      .toUpperCase()
      .replace(/[,./()]/g, "") // Remove commas, dots, slashes, parentheses
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    
    // Format index with leading zeros (e.g., 0001, 0002, etc.)
    const indexPart = String(index).padStart(4, "0")
    
    return `${buildingPart}_${assetPart}_${indexPart}`
  }

  /** Stable group id so all instances of the same BOQ asset type share one communityId (map_assets grouping). */
  const generateAssetGroupCommunityId = (buildingKey, assetName) => {
    const buildingPart = String(buildingKey || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
    const assetPart = String(assetName || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
    return `asset-group_${buildingPart}_${assetPart}`
  }

  const resolveAssetGroupCommunityId = (
    assetName,
    existingMeta,
    buildingKey,
    selectedCommunityId,
    assetGroupCommunityIds
  ) => {
    if (assetGroupCommunityIds.has(assetName)) {
      return assetGroupCommunityIds.get(assetName)
    }

    let groupId = String(existingMeta?.communityId || "").trim()
    // Legacy rows used the building community id on every asset; do not reuse that for grouping.
    if (groupId && groupId === selectedCommunityId) {
      groupId = ""
    }
    if (!groupId) {
      groupId = generateAssetGroupCommunityId(buildingKey, assetName)
    }

    assetGroupCommunityIds.set(assetName, groupId)
    return groupId
  }

  const handleCreate = async () => {
    if (!selectedCommunityId) {
      toast({
        title: "Community Required",
        description: "Please select a community",
        variant: "destructive",
      })
      return
    }

    if (!selectedBuildingId) {
      toast({
        title: "Building Required",
        description: "Please select a building",
        variant: "destructive",
      })
      return
    }

    if (!buildingName.trim()) {
      toast({
        title: "Building Name Required",
        description: "Please enter a building name",
        variant: "destructive",
      })
      return
    }

    if (mainCategories.length === 0 || assetNames.length === 0) {
      if (selectedUploadedAssetIds.length === 0) {
        toast({
          title: "Template Required",
          description: "Please load the template or select uploaded assets",
          variant: "destructive",
        })
        return
      }
    }

    setIsLoading(true)
    setUploadSuccess(false)

    try {
      const user = parseStoredUser(secureLocalStorage.getItem("user"))
      if (!user?.email) {
        toast({
          title: "Authentication Error",
          description: "Please log in again",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      // Count how many unique asset types have quantity > 0 (shown in BOQ)
      const boqAssetTypes = excelDevices.length > 0
        ? new Set(excelDevices.map(d => d.name)).size
        : Object.entries(assetCounts).filter(([, qty]) => qty > 0).length
      const totalQuantity = excelDevices.length > 0
        ? excelDevices.length
        : Object.values(assetCounts).reduce((sum, qty) => sum + qty, 0)

      const hasSelectedUploaded = selectedUploadedAssetIds.length > 0

      if (totalQuantity === 0 && !hasSelectedUploaded) {
        toast({
          title: "No Assets to Create",
          description: excelDevices.length > 0
            ? "No device records found in the uploaded Excel."
            : "Please set quantity for at least one asset or select uploaded assets.",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      let uploadedAssignCount = 0
      if (hasSelectedUploaded) {
        uploadedAssignCount = await assignSelectedUploadedAssetsToBuilding()
      }

      if (totalQuantity === 0) {
        setUploadSuccess(true)
        setSelectedUploadedAssetIds([])
        await fetchUploadedAssetsList()
        toast({
          title: "Assets Assigned",
          description: `Assigned ${uploadedAssignCount} uploaded asset(s) to ${buildingName}.`,
        })
        setIsLoading(false)
        return
      }

      console.log(`Creating assets from BOQ: ${boqAssetTypes} asset types, ${totalQuantity} total units`)

      const now = new Date().toISOString()
      let successCount = 0
      let errorCount = 0
      const categoryCount = {}
      const buildingDbName = `${buildingName}BuildingDB`

      // ── NEW FORMAT: flat excelDevices array ──────────────────────────────────
      if (excelDevices.length > 0) {
        console.log(`Saving ${excelDevices.length} device records from new Excel format`)

        for (const device of excelDevices) {
          const {
            categoryKey,
            assetCategory,
            mainCategory,
            globalId,
            name,
            deviceAddress,
            deviceLocation,
            coordinates,
            deviceType,
          } = device
          const trimmedGlobalId =
            globalId !== undefined && globalId !== null ? String(globalId).trim() : ""
          const normalizedDeviceLocation = deviceLocation != null ? String(deviceLocation) : ""

          // Use device address as document ID (unique per device)
          const safeAddress = (deviceAddress || name || "DEVICE")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_\-]/g, "_")
          const buildingAssetID = `${buildingName.toUpperCase().replace(/\s+/g, "_")}_${safeAddress}`

          if (!categoryCount[mainCategory]) categoryCount[mainCategory] = 0
          categoryCount[mainCategory]++

          /** Canonical BOQ / asset document shape (matches Firestore BOQ records from BIM imports). */
          const assetData = {
            active: 0,
            activityStatus: 0,
            assetCategory,
            assetName: normalizedDeviceLocation,
            buildingAssetId: buildingAssetID,
            buildingId: selectedBuildingId,
            buildingName,
            categoryKey,
            communityId: selectedCommunityId,
            deviceAddress: deviceAddress || "",
            deviceLocation: normalizedDeviceLocation,
            enabled: true,
            installed: false,
            mainCategory,
            quantity: 1,
            status: "Active",
            createdAt: now,
            updatedAt: now,
            createdBy: user.email || user.username || "Unknown",
          }

          if (trimmedGlobalId) assetData.globalId = trimmedGlobalId
          if (deviceType) assetData.deviceType = String(deviceType)

          if (coordinates && typeof coordinates === "object") {
            const cx = Number(coordinates.x)
            const cy = Number(coordinates.y)
            const cz = Number(coordinates.z)
            const hasAny = [cx, cy, cz].some((n) => Number.isFinite(n))
            if (hasAny) {
              assetData.coordinates = {
                ...(Number.isFinite(cx) ? { x: cx } : {}),
                ...(Number.isFinite(cy) ? { y: cy } : {}),
                ...(Number.isFinite(cz) ? { z: cz } : {}),
              }
            }
          }

          try {
            const assetDocRef = doc(db, `${buildingDbName}/asset/${categoryKey}`, buildingAssetID)
            await setDoc(assetDocRef, assetData)
            successCount++
            console.log(`✓ [${categoryKey}] ${buildingAssetID}`)
          } catch (error) {
            console.error(`✗ Error saving ${buildingAssetID}:`, error)
            errorCount++
          }
        }

      // ── LEGACY BOQ TEMPLATE FORMAT ────────────────────────────────────────────
      } else {
        const existingAssetsByName = {}
        try {
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
          for (const key of categoryKeys) {
            const categoryRef = collection(db, `${buildingDbName}/asset/${key}`)
            const snapshot = await getDocs(categoryRef)
            snapshot.forEach((docSnap) => {
              const data = docSnap.data()
              const name = data.assetName
              if (name) existingAssetsByName[name] = (existingAssetsByName[name] || 0) + 1
            })
          }
        } catch (error) {
          console.log("No existing assets found:", error)
        }

        const assetGroupCommunityIds = new Map()
        const buildingKeyForGroup = selectedBuildingId || buildingName

        for (const [assetKey, quantity] of Object.entries(assetCounts)) {
          if (quantity > 0) {
            const { category, assetName } = parseAssetKey(assetKey)
            const existingMeta = existingAssetGroups[assetName] || {}
            const assetGroupCommunityId = resolveAssetGroupCommunityId(
              assetName,
              existingMeta,
              buildingKeyForGroup,
              selectedCommunityId,
              assetGroupCommunityIds
            )
            const resolvedMainCategory =
              category === "EXISTING" ? (existingMeta.mainCategory || "EXISTING") : category
            const targetCategoryKey =
              category === "EXISTING"
                ? (existingMeta.categoryKey || "fire-life-safety")
                : "fire-life-safety"

            if (!categoryCount[resolvedMainCategory]) categoryCount[resolvedMainCategory] = 0
            categoryCount[resolvedMainCategory] += quantity

            const startIndex = (existingAssetsByName[assetName] || 0) + 1
            existingAssetsByName[assetName] = existingAssetsByName[assetName] || 0

            for (let i = 0; i < quantity; i++) {
              const currentIndex = startIndex + i
              const buildingAssetID = generateBuildingAssetID(buildingName, assetName, currentIndex)

              const assetData = {
                buildingAssetId: buildingAssetID,
                buildingName,
                buildingId: selectedBuildingId,
                communityId: assetGroupCommunityId,
                assetName,
                mainCategory: resolvedMainCategory,
                assetCategory: targetCategoryKey,
                quantity: 1,
                status: "Active",
                active: 0,
                activityStatus: 0,
                enabled: true,
                installed: false,
                createdAt: now,
                updatedAt: now,
                createdBy: user.email || user.username || "Unknown",
              }

              const detailsForKey = uploadedAssetDetails[assetKey] || []
              const instanceDetail = detailsForKey[i] || detailsForKey[i % detailsForKey.length] || {}
              if (instanceDetail.deviceLocation) assetData.deviceLocation = instanceDetail.deviceLocation
              if (instanceDetail.deviceAddress) assetData.deviceAddress = instanceDetail.deviceAddress
              if (instanceDetail.partModelNumber) assetData.partModelNumber = instanceDetail.partModelNumber

              try {
                const assetDocRef = doc(db, `${buildingDbName}/asset/${targetCategoryKey}`, buildingAssetID)
                await setDoc(assetDocRef, assetData)
                successCount++
                existingAssetsByName[assetName]++
              } catch (error) {
                console.error(`✗ Error creating ${buildingAssetID}:`, error)
                errorCount++
              }
            }
          }
        }
      }

      // Create/update building summary using buildingName as document ID
      try {
        const buildingSummaryDocRef = doc(db, buildingDbName, "buildingSummary")
        
        // Fetch existing building summary to get current counts
        const existingSummarySnap = await getDoc(buildingSummaryDocRef)
        const existingSummary = existingSummarySnap.exists() ? existingSummarySnap.data() : null
        
        // Calculate updated totals
        const currentTotalCount = existingSummary?.totalAssetsCount || 0
        const updatedTotalCount = currentTotalCount + totalQuantity
        
        // Merge category counts
        const currentCategories = existingSummary?.categories || {}
        const updatedCategories = { ...currentCategories }
        
        // Add new category counts to existing ones
        Object.entries(categoryCount).forEach(([category, count]) => {
          updatedCategories[category] = (updatedCategories[category] || 0) + count
        })
        
        const buildingSummaryDoc = {
          buildingName,
          buildingId: selectedBuildingId,
          communityId: selectedCommunityId,
          totalAssetsCount: updatedTotalCount, // Incremented total
          categories: updatedCategories, // Merged category counts
          buildingDetails: {
            name: buildingName,
            community: communities.find(c => c.id === selectedCommunityId)?.communityName || "",
          },
          lastUpdated: now,
          updatedBy: user.email || user.username || "Unknown",
        }
        
        await setDoc(buildingSummaryDocRef, buildingSummaryDoc, { merge: true })
        console.log(`✅ Building summary updated: ${currentTotalCount} + ${totalQuantity} = ${updatedTotalCount} total assets`)

        // Also save building summary to BuildingDB collection
        const buildingSummaryInBuildingDBRef = doc(db, buildingDbName, "buildingSummary")
        await setDoc(buildingSummaryInBuildingDBRef, buildingSummaryDoc, { merge: true })
        console.log(`✅ Building summary also saved to ${buildingDbName}/buildingSummary`)
      } catch (summaryError) {
        console.warn("Failed to create building summary (non-critical):", summaryError)
      }

      if (successCount > 0 || uploadedAssignCount > 0) {
        setUploadSuccess(true)
        setStep(3)
        setSelectedUploadedAssetIds([])
        await fetchUploadedAssetsList()
        const assignNote =
          uploadedAssignCount > 0
            ? ` Assigned ${uploadedAssignCount} uploaded asset(s) to ${buildingName}.`
            : ""
        toast({
          title: "BOQ Assets Created Successfully",
          description: `Created ${successCount} asset records for ${buildingName}${errorCount > 0 ? ` (${errorCount} errors)` : ""}.${assignNote}`,
        })
      } else {
        throw new Error("Failed to create any assets")
      }
    } catch (error) {
      console.error("Error creating assets:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to create assets",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setBuildingName("")
    setSelectedBuildingId("")
    setSelectedCommunityId("")
    setBuildings([])
    setPreviewData([])
    setMainCategories([])
    setAssetNames([])
    setCategoryMapping({})
    setAssetCounts({})
    setUploadedAssetDetails({})
    setUploadedAssetsList([])
    setSelectedUploadedAssetIds([])
    setExcelDevices([])
    setUploadSuccess(false)
    setStep(1)
  }

  if (!mounted) {
    return null
  }

  return (
    <DashboardHeader>
<div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <PageHelpBanner />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">Create Assets (BOQ Creation)<FaqHelpButton articleId="page-assets-create" size="md" /></h1>
            <p className="text-muted-foreground">
              Load template and create multiple asset instances with count-based duplication
            </p>
          </div>

          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="top-community-select">Select Community *</Label>
                  <Select
                    value={selectedCommunityId}
                    onValueChange={handleCommunitySelect}
                    disabled={isLoadingCommunities}
                  >
                    <SelectTrigger id="top-community-select">
                      <SelectValue placeholder={isLoadingCommunities ? "Loading communities..." : "Select a community"} />
                    </SelectTrigger>
                    <SelectContent>
                      {communities.length > 0 ? (
                        communities.map((community) => (
                          <SelectItem key={community.id} value={community.id}>
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4" />
                              <div>
                                <div className="font-medium">{community.communityName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {community.totalBuildings} building{community.totalBuildings !== 1 ? "s" : ""}
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-communities" disabled>
                          No communities available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="top-building-select">Select Building *</Label>
                  <Select
                    value={selectedBuildingId}
                    onValueChange={handleBuildingSelect}
                    disabled={!selectedCommunityId || buildings.length === 0}
                  >
                    <SelectTrigger id="top-building-select">
                      <SelectValue
                        placeholder={
                          !selectedCommunityId
                            ? "Select community first"
                            : buildings.length === 0
                              ? "No buildings in community"
                              : "Select a building"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {buildings.length > 0 ? (
                        buildings.map((building) => (
                          <SelectItem key={building.id || building._id} value={building.id || building._id}>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" />
                              {building.name || building.buildingName || building.id || building._id || "Unnamed Building"}
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-buildings" disabled>
                          {!selectedCommunityId ? "Select a community first" : "No buildings available"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {selectedBuildingId && buildingName ? (
            <Card className="shadow-sm">
              <CardHeader className="py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Assign Uploaded Assets to Building
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Assets collected on the Upload Assets page.
                  Select assets to tag with <strong>{buildingName}</strong> when you click Save BOQ.
                  The selected assets will appear on View/Edit Assets for that building.
                </p>
                {isLoadingUploadedAssets ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading uploaded assets...
                  </div>
                ) : uploadedAssetsList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No assets found in Upload Assets. Upload or collect from the panel first.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={
                                uploadedAssetsList.length > 0 &&
                                selectedUploadedAssetIds.length === uploadedAssetsList.length
                              }
                              onCheckedChange={(checked) => toggleSelectAllUploadedAssets(!!checked)}
                              aria-label="Select all uploaded assets"
                            />
                          </TableHead>
                          <TableHead>Asset ID</TableHead>
                          <TableHead>Item Type</TableHead>
                          <TableHead>Device Address</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {uploadedAssetsList.map((asset) => {
                          const isSelected = selectedUploadedAssetIds.includes(asset.id)
                          return (
                          <TableRow
                            key={asset.id}
                            className="cursor-pointer"
                            onClick={() => toggleUploadedAssetSelection(asset.id, !isSelected)}
                          >
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) =>
                                  toggleUploadedAssetSelection(asset.id, !!checked)
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell className="max-w-[140px] truncate" title={asset.assetId}>
                              {asset.assetId || "-"}
                            </TableCell>
                            <TableCell className="max-w-[140px] truncate" title={asset.itemType}>
                              {asset.itemType || "-"}
                            </TableCell>
                            <TableCell className="max-w-[120px] truncate" title={asset.deviceAddress}>
                              {asset.deviceAddress || "-"}
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate" title={asset.deviceLocation}>
                              {asset.deviceLocation || "-"}
                            </TableCell>
                            <TableCell className="max-w-[100px] truncate">
                              {asset.source === "simplex-panel" ? "Panel" : "Upload"}
                            </TableCell>
                          </TableRow>
                        )})}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {selectedUploadedAssetIds.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {selectedUploadedAssetIds.length} asset(s) will be assigned to {buildingName} on Save BOQ
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Step Indicator */}
          <div className="flex items-center gap-4 mb-6">
            {[
              { step: 1, title: "Upload", icon: Upload },
              { step: 2, title: "Configure", icon: Settings },
              { step: 3, title: "Complete", icon: CheckCircle },
            ].map(({ step: stepNum, title, icon: Icon }) => (
              <div key={stepNum} className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    step >= stepNum ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span
                  className={`text-sm font-medium ${step >= stepNum ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {title}
                </span>
                {stepNum < 3 && <div className="w-8 h-px bg-border" />}
              </div>
            ))}
          </div>

          {/* Step 1: Upload */}
          {step === 1 && (
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Community, Building & Template
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6">
                  {buildingTotalCount !== null && (
                    <div className="text-sm text-muted-foreground">
                      Total assets (building summary): <strong>{buildingTotalCount}</strong>
                    </div>
                  )}

                  {/* Show selected community and building info */}
                  {selectedCommunityId && selectedBuildingId && buildingName && (
                    <Alert>
                      <Users className="h-4 w-4" />
                      <AlertTitle>Selected Location</AlertTitle>
                      <AlertDescription>
                        Community: <strong>{communities.find(c => c.id === selectedCommunityId)?.communityName}</strong>
                        <br />
                        Building: <strong>{buildingName}</strong>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Load Template + BIM Excel upload + Panel type */}
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-3 w-full">
                      <Button
                        onClick={loadTemplate}
                        disabled={!locationReady || isLoading}
                        size="lg"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading Template...
                          </>
                        ) : (
                          <>
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            Load Template
                          </>
                        )}
                      </Button>

                      <>
                        <input
                          ref={(el) => { if (!window.__excelInputRef) window.__excelInputRef = el }}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files && e.target.files[0]
                            if (f) handleExcelFile(f)
                            e.target.value = null
                          }}
                        />
                        <Button
                          variant="outline"
                          size="lg"
                          disabled={!locationReady || isLoading}
                          onClick={() => {
                            const inp = window.__excelInputRef
                            if (inp) inp.click()
                          }}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Upload BIM Excel
                        </Button>
                      </>

                      <div className="flex flex-col gap-1.5 min-w-[200px] sm:min-w-[220px]">
                        <Label htmlFor="bim-panel-type" className="text-sm">
                          Panel type
                        </Label>
                        <Select
                          value={bimPanelType}
                          onValueChange={setBimPanelType}
                          disabled={isLoading}
                        >
                          <SelectTrigger id="bim-panel-type">
                            <SelectValue placeholder={SHIELD_OMEGA_X_BRAND} />
                          </SelectTrigger>
                          <SelectContent>
                            {BIM_PANEL_TYPES.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <>
                        <input
                          ref={panelExcelInputRef}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files && e.target.files[0]
                            if (f) handlePanelExcelFile(f)
                            e.target.value = null
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          disabled={!locationReady || isLoading}
                          onClick={() => panelExcelInputRef.current?.click()}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Panel Excel
                        </Button>
                      </>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">BOQ:</span> Load Template loads FIRE ALARM rows from the built-in schedule (panel type is SHIELD OMEGA X).{" "}
                      <span className="font-medium text-foreground">BIM Excel:</span> uses the IFC-style columns below; after import, only FIRE ALARM rows are kept for this panel type unless the file is a SHIELD S‑Explorer export.{" "}
                      <span className="font-medium text-foreground">Panel Excel:</span> SHIELD S‑Explorer only — all loop sheets like <code className="text-xs bg-muted px-1 rounded">Loop 1…N</code> (<code className="text-xs bg-muted px-1 rounded">Summary</code> skipped), columns Address, Device Type, Sub Type, Zone, Location Text.
                    </p>
                    
                    <Alert variant="outline" className="bg-muted/50">
                      <FileSpreadsheet className="h-4 w-4" />
                      <AlertTitle>
                        Selected panel layout — {bimPanelTypeLabel(bimPanelType)}
                      </AlertTitle>
                      <AlertDescription>
                        <>
                          <p className="mb-1 font-medium">
                            Supported columns ({SHIELD_OMEGA_X_BRAND} / S‑Explorer — Upload Panel Excel, all loop sheets combined):
                          </p>
                          <ul className="list-disc list-inside mt-1 space-y-1 text-sm">
                            <li><code className="bg-muted px-1 rounded">Address</code> — loop point ID (e.g. <code className="bg-muted px-1 rounded text-xs">001.00</code>); combined with sheet name for unique <code className="text-xs">deviceAddress</code> / <code className="text-xs">buildingAssetId</code> suffix.</li>
                            <li><code className="bg-muted px-1 rounded">Device Type</code> / <code className="bg-muted px-1 rounded">Sub Type</code> — describe the device class (used when building the row; not stored as extra Firestore keys).</li>
                            <li><code className="bg-muted px-1 rounded">Zone</code> / <code className="bg-muted px-1 rounded">Location Text</code> — folded into <code className="text-xs">deviceLocation</code> (with loop sheet label).</li>
                            <li><strong><code className="text-xs">assetName</code>:</strong> same value as <code className="text-xs">deviceLocation</code> (or device type label if location is empty).</li>
                            <li><code className="bg-muted px-1 rounded">Checked</code> — optional in the export; not written as a separate BOQ field.</li>
                          </ul>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Reads every worksheet except <strong>Summary</strong>. Saved assets use the same core BOQ field set as BIM imports:{" "}
                            <code className="text-xs">active</code>, <code className="text-xs">activityStatus</code>, <code className="text-xs">assetCategory</code>,{" "}
                            <code className="text-xs">assetName</code>, <code className="text-xs">buildingAssetId</code>, <code className="text-xs">buildingId</code>,{" "}
                            <code className="text-xs">buildingName</code>, <code className="text-xs">categoryKey</code>, <code className="text-xs">communityId</code>,{" "}
                            <code className="text-xs">deviceAddress</code>, <code className="text-xs">deviceLocation</code>, <code className="text-xs">enabled</code>,{" "}
                            <code className="text-xs">installed</code>, <code className="text-xs">mainCategory</code>, <code className="text-xs">quantity</code>,{" "}
                            <code className="text-xs">status</code>, <code className="text-xs">createdAt</code>, <code className="text-xs">updatedAt</code>,{" "}
                            <code className="text-xs">createdBy</code>, and <code className="text-xs">coordinates</code> when BIM provides x/y/z. <code className="text-xs">globalId</code> only when present on BIM Excel rows (not used for panel Excel).
                          </p>
                        </>

                        <p className="mt-4 mb-1 font-medium border-t border-border pt-3">
                          Supported columns (Upload BIM Excel — IFC / BIM export format):
                        </p>
                        <ul className="list-disc list-inside mt-1 space-y-1 text-sm">
                          <li><code className="bg-muted px-1 rounded">GlobalId</code> — unique IFC global identifier</li>
                          <li><code className="bg-muted px-1 rounded">Name</code> — device/asset name</li>
                          <li><code className="bg-muted px-1 rounded">FA_Device_Address</code> → saved to <strong>fire-life-safety</strong> (FIRE ALARM)</li>
                          <li><code className="bg-muted px-1 rounded">FF_Device_Address</code> → saved to <strong>fire-life-safety</strong> (FIRE FIGHTING)</li>
                          <li><code className="bg-muted px-1 rounded">HVAC_Device_Address</code> → saved to <strong>hvac</strong> (HVAC SYSTEM)</li>
                          <li><code className="bg-muted px-1 rounded">FA_DeviceLocation</code>, <code className="bg-muted px-1 rounded">FF_DeviceLocation</code>, <code className="bg-muted px-1 rounded">HVAC_DeviceLocation</code> — location labels</li>
                          <li><code className="bg-muted px-1 rounded">X_m</code>, <code className="bg-muted px-1 rounded">Y_m</code>, <code className="bg-muted px-1 rounded">Z_m</code> — 3D coordinates (saved as <code>coordinates &#123;x,y,z&#125;</code>)</li>
                        </ul>
                        <p className="mt-2 text-xs text-muted-foreground">
                          A single row may have FA, FF, or HVAC columns — each non-empty address column creates one device record. For SHIELD OMEGA X, only FIRE ALARM rows are kept unless the workbook is a SHIELD S‑Explorer multi-loop export (then all parsed panel points are used).
                        </p>

                        <p className="mt-4 mb-1 font-medium border-t border-border pt-3">Built-in BOQ template (Load Template)</p>
                        <ul className="list-disc list-inside space-y-1 text-sm">
                          <li><strong>{TEMPLATE_DATA.categories.length} categories:</strong> {TEMPLATE_DATA.categories.join(", ")}</li>
                          <li>
                            The catalog lists <strong>{TEMPLATE_DATA.assets.length}</strong> assets across categories; for SHIELD OMEGA X, <strong>Load Template</strong> shows only <strong>FIRE ALARM</strong> items.
                          </li>
                        </ul>
                      </AlertDescription>
                    </Alert>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <>
              {/* Existing Assets Summary */}
              {Object.keys(existingAssetCounts).length > 0 && (
                <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <AlertTitle className="text-blue-900 dark:text-blue-100">
                    Existing Assets Found
                  </AlertTitle>
                  <AlertDescription className="text-blue-800 dark:text-blue-200">
                    <p className="mb-2">
                      Found <strong>{Object.keys(existingAssetCounts).length}</strong> asset types with{" "}
                      <strong>{Object.values(existingAssetCounts).reduce((a, b) => a + b, 0)}</strong> total existing instances in "{buildingName}"
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium hover:underline">
                        View existing assets details
                      </summary>
                      <div className="mt-2 space-y-1 text-sm max-h-48 overflow-y-auto">
                        {Object.entries(existingAssetCounts)
                          .sort(([, a], [, b]) => b - a)
                          .map(([assetName, count]) => (
                            <div key={assetName} className="flex justify-between items-center py-1 px-2 rounded bg-blue-100/50 dark:bg-blue-900/30">
                              <span className="text-xs">{assetName}</span>
                              <Badge variant="secondary" className="text-xs">{count}</Badge>
                            </div>
                          ))}
                      </div>
                    </details>
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="grid gap-6 lg:grid-cols-2">
              {/* Category Filter */}
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Select Category to View
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 max-h-[600px] overflow-y-auto">
                  {/* Category Selector */}
                  <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <span className="text-lg">🧯</span>
                      Fire & Life Safety Category
                    </Label>
                    <Select
                      value={selectedCategory || "ALL"}
                      onValueChange={(value) => {
                        setSelectedCategory(value === "ALL" ? "" : value)
                        // Also update the FLS category mapping for the first category
                        if (value !== "ALL") {
                          setCategoryMapping((prev) => ({
                            ...prev,
                            FLS: value,
                          }))
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">
                          <div className="flex items-center gap-2 font-medium">
                            <Package className="h-4 w-4" />
                            All Categories
                          </div>
                        </SelectItem>
                        <Separator className="my-1" />
                        {mainCategories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-2">
                      Select "All Categories" to configure assets from all categories at once, or select a specific category to view only its assets.
                    </p>
                  </div>
                  
                  {/* Add New Category Button */}
                  <div className="mt-4 pt-4 border-t">
                    {!showAddCategory ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddCategory(true)}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add New Category
                      </Button>
                    ) : (
                      <div className="space-y-3 p-3 border rounded-lg bg-muted/50">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Add New Category</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowAddCategory(false)
                              setNewCategoryName("")
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <Input
                            placeholder="Category name (e.g., ELECTRICAL SYSTEMS)"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            className="text-sm"
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              if (newCategoryName.trim()) {
                                const categoryName = newCategoryName.trim()
                                // Check if category already exists
                                if (mainCategories.includes(categoryName)) {
                                  toast({
                                    title: "Category Exists",
                                    description: "This category already exists",
                                    variant: "destructive",
                                  })
                                  return
                                }
                                // Add new category
                                setMainCategories((prev) => [...prev, categoryName])
                                // Initialize with suggested mapping
                                const suggestedMapping = suggestCategory(categoryName, "")
                                setCategoryMapping((prev) => ({
                                  ...prev,
                                  [categoryName]: suggestedMapping,
                                }))
                                // Reset form
                                setNewCategoryName("")
                                setShowAddCategory(false)
                                toast({
                                  title: "Category Added",
                                  description: `Added category "${categoryName}"`,
                                })
                              } else {
                                toast({
                                  title: "Invalid Input",
                                  description: "Please provide a category name",
                                  variant: "destructive",
                                })
                              }
                            }}
                            className="w-full"
                          >
                            Add Category
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Asset Counts */}
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Asset Counts
                    {selectedCategory ? (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {selectedCategory}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 text-xs">
                        All Categories
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {selectedCategory 
                      ? `Showing assets in ${selectedCategory} category`
                      : `Showing all ${previewData.length} assets from ${mainCategories.length} categories`}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 max-h-[600px] overflow-y-auto">
                    {!selectedCategory ? (
                      // Show all categories grouped
                      mainCategories.map((category) => {
                        const categoryAssets = previewData.filter((item) => item.mainCategory === category)
                        const categoryAssetCount = categoryAssets.reduce((sum, item) => {
                          const key = getAssetKey(item.mainCategory, item.assetName)
                          return sum + (assetCounts[key] || 0)
                        }, 0)
                        
                        return (
                          <div key={category} className="space-y-2">
                            {/* Category Header */}
                            <div className="sticky top-0 bg-background z-10 flex items-center justify-between p-2 border-b-2 border-primary/20">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs font-semibold">
                                  {category}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  ({categoryAssets.length} assets)
                                </span>
                              </div>
                              {categoryAssetCount > 0 && (
                                <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-xs">
                                  {categoryAssetCount} to create
                                </Badge>
                              )}
                            </div>
                            
                            {/* Category Assets */}
                            <div className="space-y-2 ml-2">
                              {categoryAssets.map((item, idx) => {
                                const assetKey = getAssetKey(item.mainCategory, item.assetName)
                                const assetName = item.assetName
                                const existingCount = existingAssetCounts[assetName] || 0
                                const newCount = assetCounts[assetKey] || 0
                                return (
                                  <div key={`${assetKey}-${idx}`} className="flex items-center justify-between p-2 border rounded-lg bg-muted/20">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-xs truncate">{assetName}</div>
                                      <div className="text-[10px] text-muted-foreground space-y-0.5">
                                        {existingCount > 0 && (
                                          <span className="text-blue-600 dark:text-blue-400">Existing: {existingCount} | </span>
                                        )}
                                        <span>New: {newCount}</span>
                                        {existingCount > 0 && newCount > 0 && (
                                          <span className="text-green-600 dark:text-green-400"> | Total: {existingCount + newCount}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => updateAssetCount(assetKey, -1)}
                                        disabled={newCount <= 0}
                                        className="h-7 w-7 p-0"
                                      >
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={newCount}
                                        onChange={(e) => handleDirectCountChange(assetKey, e.target.value)}
                                        className="w-14 h-7 text-center text-xs p-1"
                                      />
                                      <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => updateAssetCount(assetKey, 1)}
                                        className="h-7 w-7 p-0"
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      // Show single category
                      <div className="space-y-3">
                        {previewData
                          .filter((item) => item.mainCategory === selectedCategory)
                          .map((item, idx) => {
                            const assetKey = getAssetKey(item.mainCategory, item.assetName)
                            const assetName = item.assetName
                            const existingCount = existingAssetCounts[assetName] || 0
                            const newCount = assetCounts[assetKey] || 0
                            return (
                              <div key={`${assetKey}-${idx}`} className="flex items-center justify-between p-3 border rounded-lg">
                                <div className="flex-1">
                                  <div className="font-medium text-sm">{assetName}</div>
                                  <div className="text-xs text-muted-foreground space-y-0.5">
                                    {existingCount > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs">
                                          Existing: {existingCount}
                                        </Badge>
                                      </div>
                                    )}
                                    <div>
                                      Will create {newCount} new instance
                                      {newCount !== 1 ? "s" : ""}
                                    </div>
                                    {existingCount > 0 && newCount > 0 && (
                                      <div className="text-green-600 dark:text-green-400 font-medium">
                                        Total after creation: {existingCount + newCount}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateAssetCount(assetKey, -1)}
                                    disabled={newCount <= 0}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={newCount}
                                    onChange={(e) => handleDirectCountChange(assetKey, e.target.value)}
                                    className="w-16 text-center text-sm"
                                  />
                                  <Button variant="outline" size="sm" onClick={() => updateAssetCount(assetKey, 1)}>
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            )
                          })
                        }
                      </div>
                    )}
                  </div>
                  
                  {/* Add New Asset Button */}
                  <div className="mt-4 pt-4 border-t">
                    {!showAddAsset ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddAsset(true)}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add New Asset
                      </Button>
                    ) : (
                      <div className="space-y-3 p-3 border rounded-lg bg-muted/50">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Add New Asset</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowAddAsset(false)
                              setNewAssetName("")
                              setNewAssetCategory("")
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <Input
                            placeholder="Asset name"
                            value={newAssetName}
                            onChange={(e) => setNewAssetName(e.target.value)}
                            className="text-sm"
                          />
                          <Select value={newAssetCategory} onValueChange={setNewAssetCategory}>
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              {mainCategories.map((category) => (
                                <SelectItem key={category} value={category}>
                                  {category}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            onClick={() => {
                              if (newAssetName.trim() && newAssetCategory) {
                                // Add new asset to the list
                                setAssetNames((prev) => [...prev, newAssetName.trim()])
                                setAssetCounts((prev) => ({
                                  ...prev,
                                  [newAssetName.trim()]: 0,
                                }))
                                // Add to template data for preview
                                setPreviewData((prev) => [
                                  ...prev,
                                  {
                                    mainCategory: newAssetCategory,
                                    assetName: newAssetName.trim(),
                                  },
                                ])
                                // Reset form
                                setNewAssetName("")
                                setNewAssetCategory("")
                                setShowAddAsset(false)
                                toast({
                                  title: "Asset Added",
                                  description: `Added "${newAssetName.trim()}" to ${newAssetCategory}`,
                                })
                              } else {
                                toast({
                                  title: "Invalid Input",
                                  description: "Please provide asset name and category",
                                  variant: "destructive",
                                })
                              }
                            }}
                            className="w-full"
                          >
                            Add Asset
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              </div>
            </>
          )}

          {/* Template Preview - BOQ (Only show assets with quantity > 0) */}
          {previewData.length > 0 && step === 2 && (
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  BOQ (Bill of Quantities)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Showing {previewData.filter(row => {
                    const key = getAssetKey(row.mainCategory, row.assetName)
                    return (assetCounts[key] || 0) > 0
                  }).length} assets with quantity greater than 0
                </p>
              </CardHeader>
              <CardContent>
                {(() => {
                  const templateRows = previewData.filter((row) => {
                    const key = getAssetKey(row.mainCategory, row.assetName)
                    return (assetCounts[key] || 0) > 0
                  })
                  const existingOnlyRows = Object.entries(existingAssetGroups)
                    .filter(([assetName]) => !previewData.some((row) => row.assetName === assetName))
                    .filter(([assetName]) => (assetCounts[getAssetKey("EXISTING", assetName)] || 0) > 0)
                    .map(([assetName, meta]) => ({
                      mainCategory: meta.mainCategory || "EXISTING",
                      assetName,
                      isExistingOnly: true,
                    }))
                  const boqRows = [...templateRows, ...existingOnlyRows]

                  if (boqRows.length === 0) {
                    return (
                      <div className="space-y-3">
                        {Object.keys(existingAssetGroups).length > 0 ? (
                          <div className="border rounded-md overflow-auto max-h-[420px]">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Main Category</TableHead>
                                  <TableHead>Existing BOQ Asset</TableHead>
                                  <TableHead className="text-center">Increment</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {Object.entries(existingAssetGroups)
                                  .sort(([, a], [, b]) => b.count - a.count)
                                  .map(([assetName, meta]) => {
                                    const assetKey = getAssetKey("EXISTING", assetName)
                                    const existingCount = meta.count || 0
                                    const newCount = assetCounts[assetKey] || 0
                                    const displayedCount = getDisplayedCount(assetKey, existingCount)
                                    return (
                                      <TableRow key={`existing-${assetName}`}>
                                        <TableCell>{meta.mainCategory || "EXISTING"}</TableCell>
                                        <TableCell>
                                          <div className="font-medium text-sm">{assetName}</div>
                                          <Badge variant="outline" className="text-xs mt-1">
                                            Existing: {meta.count}
                                          </Badge>
                                        </TableCell>
                                        <TableCell>
                                          <div className="flex items-center justify-center gap-1">
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => adjustDisplayedCount(assetKey, -1, existingCount)}
                                              disabled={displayedCount <= existingCount}
                                              className="h-7 w-7 p-0"
                                            >
                                              <Minus className="h-3 w-3" />
                                            </Button>
                                            <Input
                                              type="number"
                                              min="0"
                                              value={displayedCount}
                                              onChange={(e) => handleDisplayedCountChange(assetKey, e.target.value, existingCount)}
                                              className="w-14 h-7 text-center text-sm px-1"
                                            />
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => adjustDisplayedCount(assetKey, 1, existingCount)}
                                              className="h-7 w-7 p-0"
                                            >
                                              <Plus className="h-3 w-3" />
                                            </Button>
                                          </div>
                                          {newCount > 0 && (
                                            <div className="text-xs text-center text-green-600 dark:text-green-400 mt-1 font-medium">
                                              New Total: {meta.count + newCount}
                                            </div>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    )
                                  })}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>No Assets Selected</AlertTitle>
                            <AlertDescription>
                              Please set quantity for at least one asset in the Asset Counts section above to see it in the BOQ.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )
                  }

                  return (
                    <>
                      <div className="border rounded-md overflow-auto max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Main Category</TableHead>
                              <TableHead>Asset Name</TableHead>
                              <TableHead>Target Category</TableHead>
                              <TableHead className="text-center">Quantity</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {boqRows.map((row, index) => {
                              const assetKey = row.isExistingOnly
                                ? getAssetKey("EXISTING", row.assetName)
                                : getAssetKey(row.mainCategory, row.assetName)
                              const existingCount = existingAssetCounts[row.assetName] || 0
                              const newCount = assetCounts[assetKey] || 0
                              const displayedCount = getDisplayedCount(assetKey, existingCount)
                              
                              const targetSystemCategory = ASSET_CATEGORIES["fire-life-safety"]
                              
                              return (
                                <TableRow key={`${assetKey}-${index}`}>
                                  <TableCell>{row.mainCategory}</TableCell>
                                  <TableCell>
                                    <div>
                                      <div className="font-medium text-sm">{row.assetName}</div>
                                      {existingCount > 0 && (
                                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs mt-1">
                                          Existing: {existingCount}
                                        </Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline">
                                      {targetSystemCategory.icon}{" "}
                                      {targetSystemCategory.name}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center justify-center gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => adjustDisplayedCount(assetKey, -1, existingCount)}
                                        disabled={displayedCount <= existingCount}
                                        className="h-7 w-7 p-0"
                                      >
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={displayedCount}
                                        onChange={(e) => handleDisplayedCountChange(assetKey, e.target.value, existingCount)}
                                        className="w-14 h-7 text-center text-sm px-1"
                                      />
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => adjustDisplayedCount(assetKey, 1, existingCount)}
                                        className="h-7 w-7 p-0"
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    {existingCount > 0 && newCount > 0 && (
                                      <div className="text-xs text-center text-green-600 dark:text-green-400 mt-1 font-medium">
                                        Total: {existingCount + newCount}
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground">
                          Existing BOQ assets are grouped; set increment to add only new quantity.
                        </p>
                        <p className="text-sm font-medium">
                          Total to create: <Badge variant="secondary" className="ml-1">
                            {Object.values(assetCounts).reduce((sum, count) => sum + count, 0)}
                          </Badge>
                        </p>
                      </div>
                    </>
                  )
                })()}
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          {step === 2 && (
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back to Upload
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  isLoading ||
                  !selectedCommunityId ||
                  !selectedBuildingId ||
                  !buildingName ||
                  (mainCategories.length === 0 && selectedUploadedAssetIds.length === 0)
                }
                className="flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving BOQ...
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" />
                    Save BOQ
                    {Object.values(assetCounts).reduce((sum, count) => sum + count, 0) > 0
                      ? ` (${Object.values(assetCounts).reduce((sum, count) => sum + count, 0)} template)`
                      : ""}
                    {selectedUploadedAssetIds.length > 0
                      ? ` + ${selectedUploadedAssetIds.length} uploaded`
                      : ""}
                  </>
                )}
              </Button>
              {Object.values(assetCounts).reduce((sum, count) => sum + count, 0) === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ No assets in BOQ. Set quantity for at least one asset above.
                </p>
              )}
            </div>
          )}

          {/* Step 3: Success */}
          {step === 3 && uploadSuccess && (
            <Card className="shadow-md">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                    <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-green-600 dark:text-green-400">
                      Assets Created Successfully!
                    </h3>
                    <p className="text-muted-foreground mt-2">
                      All assets have been created for building "{buildingName}" with the specified counts and
                      categories.
                    </p>
                  </div>
                  <div className="flex gap-4 justify-center">
                    <Button onClick={resetForm} variant="outline">
                      Create More Assets
                    </Button>
                    <Button onClick={() => (window.location.href = "/dashboard")}>Go to Dashboard</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
  </DashboardHeader>  )
}