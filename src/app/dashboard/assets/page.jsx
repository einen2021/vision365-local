"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { DashboardHeader } from "@/components/dashboard-header"
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges"
import dynamic from "next/dynamic"
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  { ssr: false, loading: () => <div className="h-9 w-9" /> }
)
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Upload, FileSpreadsheet, CheckCircle2, Image as ImageIcon, X, Loader2, Package, Search, MoreHorizontal, Trash2, FileText, ClipboardPaste } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import * as XLSX from "xlsx"
import { db, storage } from "@/config/firebase"
import { useAppData } from "@/hooks/useAppData"
import { getBrandOptionsFromRegistry, loadBrandRegistry } from "@/utils/brandRegistryService"
import secureLocalStorage from "react-secure-storage"
import { collection, addDoc, addDocsBatch, setDocsBatch, deleteDocsBatch, getDocs, query, where, orderBy, limit, doc, updateDoc, deleteDoc } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"
import { useFirePanelStore } from "@/stores/firePanelStore"
import { apiFetch } from "@/lib/apiClient"
import { parseSimplexFile } from "@/lib/parseSimplexFile"
import { resolveAssetDeviceAddress, resolveSimplexDeviceAddress } from "@/lib/simplexDeviceAddress"

const normalizeMatchValue = (value) => String(value || "").toLowerCase().trim()

const SINGLE_ASSET_HIERARCHY = {
  categories: [
    "FIRE & LIFE SAFETY (FLS)",
    "HVAC SYSTEMS",
    "ELECTRICAL SYSTEMS",
    "ELV / LOW CURRENT SYSTEMS",
    "PLUMBING & WATER SYSTEMS",
    "TRANSPORT SYSTEMS",
    "BMS / IBMS (BUILDING MANAGEMENT SYSTEM)",
    "ENERGY & SUSTAINABILITY SYSTEMS",
    "DIGITAL / SMART SYSTEMS (VISION365)",
  ],
  systemsByCategory: {
    "FIRE & LIFE SAFETY (FLS)": [
      "Fire Alarm System (FAS)",
      "Fire Fighting System (FF)",
      "Emergency & Life Safety Systems",
      "Public Address & Voice Alarm (PAVA)",
    ],
  },
  subsystemsBySystem: {
    "Emergency & Life Safety Systems": [
      "Central Battery System (CBS)",
      "Central Monitoring System (CMS)",
      "Self Contained Lights",
    ],
  },
  subSubsystemsBySubsystem: {},
}

const getFireTemplateByItemType = (itemType) => {
  const normalized = normalizeMatchValue(itemType)
  if (
    normalized.includes("fire alarm control panel") ||
    normalized.includes("facp") ||
    normalized.includes("panel")
  ) {
    return "facp"
  }
  if (normalized.includes("smoke detector")) return "smoke_detector"
  if (normalized.includes("heat detector")) return "heat_detector"
  if (normalized.includes("manual call") || normalized.includes("break glass")) return "manual_call_point"
  if (normalized.includes("monitor module")) return "monitor_module"
  if (normalized.includes("control module")) return "control_module"
  if (normalized.includes("speaker") || normalized.includes("pava") || normalized.includes("voice evacuation")) return "speaker"
  if (normalized.includes("flasher") || normalized.includes("beacon")) return "flasher"
  if (normalized.includes("sounder") || normalized.includes("horn")) return "sounder"
  return null
}

const TECHNICAL_PROPERTY_TEMPLATES = {
  facp: {
    label: "Fire Alarm Control Panel (FACP) Properties",
    fields: [
      "Panel Name",
      "Panel Model",
      "Manufacturer",
      "Firmware Version",
      "Serial Number",
      "IP Address",
      "Network Node ID",
      "Loop Quantity",
      "Zone Quantity",
      "Battery Voltage",
      "Charger Status",
      "AC Power Status",
      "Earth Fault Status",
      "Live Status",
      "Event Logs",
      "Alarm History",
      "Fault History",
      "Operator Actions",
      "Time & Date Stamp",
      "Device Activation Logs",
    ],
  },
  smoke_detector: {
    label: "Smoke Detector Properties",
    fields: [
      "Device Name",
      "Address / Loop No.",
      "Zone",
      "Location Text",
      "Detector Type",
      "Sensitivity Level (%)",
      "Drift Compensation Value",
      "Contamination Level",
      "Smoke Value (Live Analog Reading)",
      "Alarm Threshold",
      "Pre-Alarm Threshold",
      "LED Status",
      "Sounder Base Enabled",
      "Dirty Detector Warning",
      "Missing Device Fault",
      "Disabled / Enabled",
    ],
  },
  heat_detector: {
    label: "Heat Detector Properties",
    fields: [
      "Address",
      "Zone",
      "Location",
      "Detector Type",
      "Temperature Reading",
      "Alarm Temperature Threshold",
      "Rate of Rise Setting",
      "Compensation Status",
      "Fault Status",
      "Disabled / Enabled",
    ],
  },
  manual_call_point: {
    label: "Manual Call Point / Break Glass Properties",
    fields: [
      "Address",
      "Zone",
      "Location",
      "Device Type",
      "Activated Status",
      "Reset Status",
      "Cover Open Tamper",
      "Wiring Fault",
      "Disabled / Enabled",
    ],
  },
  monitor_module: {
    label: "Monitor Module Properties",
    fields: [
      "Address",
      "Zone",
      "Location",
      "Input Type (NO / NC / EOL)",
      "Current Status",
      "Alarm / Supervisory / Trouble Mapping",
      "Delay Timer",
      "Normal State",
      "Wiring Fault",
      "Last Activated Time",
    ],
  },
  control_module: {
    label: "Control Module Properties",
    fields: [
      "Address",
      "Zone",
      "Location",
      "Output Type (Relay / NAC / Dry Contact)",
      "ON / OFF Status",
      "Pulse Mode",
      "Delay Timer",
      "Cause & Effect Logic",
      "Feedback Status",
      "Manual Override",
      "Fault Status",
    ],
  },
  speaker: {
    label: "Speaker (Voice Evacuation / PAVA) Properties",
    fields: [
      "Circuit No.",
      "Zone",
      "Location",
      "Line Voltage",
      "Watt Tap Setting",
      "Audio Circuit Status",
      "Open Circuit Fault",
      "Short Circuit Fault",
      "Volume Setting",
      "Message Group Assignment",
    ],
  },
  flasher: {
    label: "Flasher / Beacon Properties",
    fields: [
      "Address / Circuit",
      "Zone",
      "Location",
      "Flash Rate",
      "Color",
      "Sync Status",
      "Activated / Normal",
      "Fault Status",
    ],
  },
  sounder: {
    label: "Sounder / Horn Properties",
    fields: [
      "Address / Circuit",
      "Zone",
      "Location",
      "Tone Type",
      "Sound Level (dB)",
      "Sync Status",
      "Activated / Silence",
      "Open Circuit Fault",
      "Short Circuit Fault",
    ],
  },
  cbs_panel: {
    label: "Central Battery System (CBS) - Main Panel Properties",
    fields: [
      "Panel Name",
      "Manufacturer",
      "Model",
      "Serial Number",
      "Location",
      "Input Voltage",
      "Output Voltage",
      "Battery Voltage",
      "Battery Capacity (Ah)",
      "Charger Healthy",
      "Inverter Healthy",
      "Mains Healthy",
      "Earth Fault",
      "Fuse Status",
      "Battery Temperature",
      "Remaining Runtime",
      "Alarm / Fault / Normal",
      "Auto Test Enabled",
      "IP Address",
      "BMS / Vision365 Tag",
    ],
  },
  cbs_light: {
    label: "CBS - Per Light Properties",
    fields: [
      "Asset ID",
      "Circuit No.",
      "Address",
      "Zone",
      "Floor",
      "Area",
      "Type",
      "Maintained / Non-maintained",
      "LED / Fluorescent",
      "Wattage",
      "Lamp Status",
      "Battery Feed Healthy",
      "Communication Healthy",
      "Last Function Test",
      "Last Duration Test",
      "Fault Status",
      "Replace Due Date",
    ],
  },
  central_monitoring: {
    label: "Central Monitoring System Properties",
    fields: [
      "Server Name",
      "CPU",
      "RAM",
      "Storage",
      "UPS Healthy",
      "Screen Quantity",
      "Printer Healthy",
      "Workstation Name",
      "OS Version",
      "Monitoring Software Version",
      "Database Healthy",
      "Backup Status",
      "License Validity",
      "Antivirus Healthy",
      "Last Update Date",
      "Total Lights Connected",
      "Healthy Lights",
      "Fault Lights",
      "Communication Loss",
      "Test Due",
    ],
  },
  fm200: {
    label: "FM200 Clean Agent System Properties",
    fields: [
      "Cylinder ID",
      "Manufacturer",
      "Capacity (kg)",
      "Agent Weight",
      "Pressure (bar)",
      "Gauge Healthy",
      "Hydrotest Due",
      "Refill Due",
      "Mounting Status",
      "Smoke Detector Zone A",
      "Smoke Detector Zone B",
      "Cross Zoning Enabled",
      "Manual Release MCP",
      "Abort Switch",
      "Delay Timer",
      "Solenoid Healthy",
      "Pressure Switch Healthy",
      "Release Panel Healthy",
      "Room Name",
      "Volume (m3)",
      "Design Concentration",
      "Door Fan Test Date",
      "Leakage Pass/Fail",
      "AHU Shutdown Linked",
      "Damper Shutdown Linked",
    ],
  },
  fire_pump: {
    label: "Fire Fighting System - Fire Pump Properties",
    fields: [
      "Pump Type",
      "Running Status",
      "Auto / Manual",
      "Pressure",
      "Flow",
      "Motor Current",
      "Diesel Fuel Level",
      "Battery Charger Healthy",
      "Weekly Test Done",
      "Hours Run",
    ],
  },
  fire_water_tank: {
    label: "Fire Fighting System - Water Tank Properties",
    fields: [
      "Tank Capacity",
      "Water Level",
      "Low Level Alarm",
      "Refill Valve Healthy",
      "Leak Status",
    ],
  },
  sprinkler_system: {
    label: "Fire Fighting System - Sprinkler Properties",
    fields: [
      "Sprinkler Type",
      "Zone",
      "Pressure",
      "Flow Switch",
      "Tamper Switch",
      "Valve Open / Closed",
      "Last Test Date",
    ],
  },
  hydrant_system: {
    label: "Fire Fighting System - Hydrant / Hose Reel Properties",
    fields: [
      "Hose Reel No.",
      "Landing Valve No.",
      "Pressure",
      "Cabinet Condition",
      "Hose Condition",
      "Nozzle Present",
      "Valve Operational",
    ],
  },
  extinguisher: {
    label: "Portable Extinguisher Properties",
    fields: [
      "Extinguisher Type",
      "Capacity",
      "Pressure OK",
      "Seal Intact",
      "Service Due",
      "Mounted Correctly",
    ],
  },
}

const getTechnicalTemplateId = (category, system, itemType) => {
  const normalizedCategory = normalizeMatchValue(category)
  const normalizedSystem = normalizeMatchValue(system)
  const normalizedItemType = normalizeMatchValue(itemType)

  if (
    normalizedSystem.includes("central battery") ||
    normalizedCategory.includes("exit") ||
    normalizedCategory.includes("emergency light")
  ) {
    if (normalizedItemType.includes("panel")) return "cbs_panel"
    return "cbs_light"
  }

  if (normalizedSystem.includes("central monitoring")) return "central_monitoring"
  if (normalizedSystem.includes("fm200")) return "fm200"

  if (normalizedSystem.includes("fire fighting")) {
    if (normalizedItemType.includes("pump")) return "fire_pump"
    if (normalizedItemType.includes("tank")) return "fire_water_tank"
    if (normalizedItemType.includes("sprinkler")) return "sprinkler_system"
    if (normalizedItemType.includes("hydrant") || normalizedItemType.includes("hose reel")) return "hydrant_system"
    if (normalizedItemType.includes("extinguisher")) return "extinguisher"
  }

  if (
    normalizedSystem.includes("fire alarm") ||
    normalizedCategory.includes("fire and life safety") ||
    normalizedCategory.includes("fire-life-safety")
  ) {
    return getFireTemplateByItemType(itemType)
  }

  return null
}

// Component to handle asset image display with error handling and upload
const AssetImageCell = ({ asset, onImageClick, pendingImageUrl, isUploading }) => {
  const [imageError, setImageError] = useState(false)
  const fileInputRef = useRef(null)

  // Reset error state when asset changes
  useEffect(() => {
    setImageError(false)
  }, [asset.customImageUrl])

  const handleClick = () => {
    if (onImageClick && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const displayUrl = pendingImageUrl || asset.customImageUrl

  if (!displayUrl || displayUrl.trim() === "" || imageError) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0] && onImageClick) {
              onImageClick(asset.id, e.target.files[0])
            }
            e.target.value = "" // Reset input
          }}
        />
        <div
          className={`w-10 h-10 rounded bg-muted flex items-center justify-center ${onImageClick ? "cursor-pointer hover:bg-muted/80 transition-colors" : ""}`}
          onClick={handleClick}
          title={onImageClick ? "Click to upload image" : ""}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0] && onImageClick) {
            onImageClick(asset.id, e.target.files[0])
          }
          e.target.value = "" // Reset input
        }}
      />
      <img
        src={displayUrl}
        alt={asset.assetId || "Asset"}
        className={`w-10 h-10 rounded object-cover ${onImageClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
        onError={() => setImageError(true)}
        onClick={handleClick}
        title={onImageClick ? "Click to change image" : ""}
      />
    </>
  )
}

// Convert column name to camelCase field name
const normalizeFieldName = (columnName) => {
  if (!columnName) return null
  
  const normalized = columnName.trim().toLowerCase()
  
  // Skip "Sl No" or similar serial number columns
  if (normalized === "sl no" || normalized === "sl.no" || normalized === "sl. no" || 
      normalized === "s.no" || normalized === "s no" || normalized === "sno" ||
      normalized === "serial no" || normalized === "serial number") {
    return null
  }
  
  // Handle special case: part/model number -> partNumber
  if (normalized.includes("part") && normalized.includes("model")) {
    return "partNumber"
  }
  
  // Convert to camelCase
  return columnName
    .trim()
    .split(/[\s_]+/)
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join("")
}

const SIMPLEX_COLLECT_BRAND = "Simplex"
const SIMPLEX_COLLECT_SYSTEM = "Fire Alarm System (FAS)"
const SIMPLEX_COLLECT_CATEGORY = "FIRE & LIFE SAFETY (FLS)"
const CSHOW_COLLECT_TIMEOUT_MS = 60000

function generateAssetId(brand, system, itemType, index) {
  const brandPart = brand ? brand.trim().toUpperCase().replace(/\s+/g, "-") : "NOBRAND"
  const systemPart = system ? system.trim().toUpperCase().replace(/\s+/g, "-") : "NOSYS"
  const itemTypePart = itemType ? itemType.trim().toUpperCase().replace(/\s+/g, "-") : "NOTYPE"
  const indexPart = String(index).padStart(4, "0")
  return `${brandPart}_${systemPart}_${itemTypePart}_${indexPart}`
}

function simplexDeviceToAsset(device, assetId) {
  const now = new Date().toISOString()
  const itemType = device.BAN || device.PointType || device.DeviceType || "Fire Device"
  const deviceAddress = resolveSimplexDeviceAddress({
    deviceAddress: device.DeviceAddress,
    loopNumber: device.LoopNumber,
    deviceNumber: device.DeviceNumber,
    subAdd: device.SubAdd,
    panel: device.Panel,
    includeZeroSubAdd: device.SubAdd === 0,
  })

  return {
    assetId,
    brand: SIMPLEX_COLLECT_BRAND,
    manufacturer: SIMPLEX_COLLECT_BRAND,
    system: SIMPLEX_COLLECT_SYSTEM,
    systems: [SIMPLEX_COLLECT_SYSTEM],
    category: SIMPLEX_COLLECT_CATEGORY,
    itemType,
    description: device.DeviceLocation || device.BAN || itemType,
    deviceLocation: device.DeviceLocation || "",
    deviceAddress,
    panelAddress: device.PanelAddress || "",
    panel: device.Panel ?? "",
    loopNumber: device.LoopNumber ?? "",
    deviceNumber: device.DeviceNumber ?? "",
    subAdd: device.SubAdd ?? 0,
    pointType: device.PointType || "",
    deviceType: device.DeviceType || "",
    ban: device.BAN || "",
    model: device.DeviceType || "",
    partNumber: deviceAddress,
    cval: device.CVAL || "",
    peak: device.PEAK || "",
    technicalProperties: {
      templateId: "",
      templateName: "",
      values: {
        "Device Name": deviceAddress,
        "Address / Loop No.": device.PanelAddress || "",
        "Location Text": device.DeviceLocation || "",
        "Detector Type": device.DeviceType || "",
        CVAL: device.CVAL || "",
        PEAK: device.PEAK || "",
      },
    },
    simplexStatus: {
      F: device.F ?? null,
      T: device.T ?? null,
      S: device.S ?? null,
      D: device.D ?? false,
    },
    source: "simplex-panel",
    customImageUrl: "",
    logs: [],
    createdAt: now,
    updatedAt: now,
    rowNumber: 0,
  }
}

/** Save parsed Simplex M-devices to AssetsList (shared by panel collect + TXT import). */
async function importSimplexDevicesToAssetsList(devices, onProgress) {
  const assetsCollection = collection(db, "AssetsList")
  const existingAssetsSnapshot = await getDocs(assetsCollection)
  const existingAssetCount = existingAssetsSnapshot.size

  const existingDocIds = new Set()
  const existingDeviceAddresses = new Set()

  existingAssetsSnapshot.forEach((docSnap) => {
    const row = docSnap.data()
    existingDocIds.add(docSnap.id.toLowerCase())
    const addr = resolveAssetDeviceAddress(row)
    if (addr) existingDeviceAddresses.add(addr.toLowerCase())
  })

  const newAssets = []
  let skippedCount = 0

  devices.forEach((device) => {
    const address = resolveSimplexDeviceAddress({
      deviceAddress: device.DeviceAddress,
      loopNumber: device.LoopNumber,
      deviceNumber: device.DeviceNumber,
      subAdd: device.SubAdd,
      panel: device.Panel,
      includeZeroSubAdd: device.SubAdd === 0,
    })
    if (!address) {
      skippedCount++
      return
    }

    const normalizedAddress = address.toLowerCase()
    if (
      existingDocIds.has(normalizedAddress) ||
      existingDeviceAddresses.has(normalizedAddress)
    ) {
      skippedCount++
      return
    }

    const assetId = generateAssetId(
      SIMPLEX_COLLECT_BRAND,
      SIMPLEX_COLLECT_SYSTEM,
      device.BAN || device.PointType || "Device",
      existingAssetCount + newAssets.length + 1,
    )

    existingDeviceAddresses.add(normalizedAddress)
    existingDocIds.add(normalizedAddress)
    newAssets.push({
      id: address,
      data: simplexDeviceToAsset(device, assetId),
    })
  })

  if (newAssets.length === 0) {
    return {
      successCount: 0,
      skippedCount,
      errorCount: 0,
      parsedCount: devices.length,
      empty: true,
    }
  }

  let successCount = 0
  let errorCount = 0
  const batchSize = 25

  const saveBatchWithRetry = async (batch, maxAttempts = 4) => {
    let lastError = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await setDocsBatch(assetsCollection, batch)
        return true
      } catch (error) {
        lastError = error
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
        }
      }
    }
    console.error("Error saving simplex asset batch:", lastError)
    return false
  }

  for (let i = 0; i < newAssets.length; i += batchSize) {
    const batch = newAssets.slice(i, i + batchSize)
    const saved = await saveBatchWithRetry(batch)
    if (saved) {
      successCount += batch.length
    } else {
      errorCount += batch.length
    }
    onProgress?.({
      total: newAssets.length,
      processed: Math.min(i + batchSize, newAssets.length),
    })
  }

  return {
    successCount,
    skippedCount,
    errorCount,
    parsedCount: devices.length,
    empty: false,
  }
}

export default function AssetsPage() {
  const [uploadMode, setUploadMode] = useState("bulk")
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [previewData, setPreviewData] = useState([])
  const [previewHeaders, setPreviewHeaders] = useState([])
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const { communities, isReady } = useAppData({ toastOnCommunitiesError: true })
  const [buildings, setBuildings] = useState([])
  const [selectedCommunityId, setSelectedCommunityId] = useState("")
  const [selectedBuildingName, setSelectedBuildingName] = useState("")
  const [uploadProgress, setUploadProgress] = useState({ total: 0, processed: 0 })
  const [uploadSummary, setUploadSummary] = useState({ success: 0, skipped: 0, errors: 0 })
  const [sheetNames, setSheetNames] = useState([])
  const [selectedSheet, setSelectedSheet] = useState("")
  const [workbook, setWorkbook] = useState(null)
  const [assetImages, setAssetImages] = useState({}) // Store images for each asset by row index
  const [uploadingImages, setUploadingImages] = useState({}) // Track image upload progress
  const [existingAssets, setExistingAssets] = useState([]) // Store already uploaded assets
  const [isLoadingExistingAssets, setIsLoadingExistingAssets] = useState(false)
  const [searchTerm, setSearchTerm] = useState("") // Search term for assets
  const [filterBrand, setFilterBrand] = useState("all") // Filter by brand
  const [filterCategory, setFilterCategory] = useState("all") // Filter by category
  const [filterSystem, setFilterSystem] = useState("all") // Filter by system
  const [pendingImageUploads, setPendingImageUploads] = useState({}) // Track pending image uploads: {assetId: {file, url, uploading}}
  const [isSavingImages, setIsSavingImages] = useState(false) // Track if saving images
  const fileInputRef = useRef(null)

  // Asset documents (Data Sheet, Brochure, Installation/Operation Guide, etc.)
  const [docUploadModal, setDocUploadModal] = useState(null) // { assetId, docTypeKey, categoryKey, buildingAssetId } | null
  const [docDragActive, setDocDragActive] = useState(false)
  const [uploadingDocTypes, setUploadingDocTypes] = useState({}) // { [assetId]: { [docTypeKey]: true } }
  const [docPreviewDialog, setDocPreviewDialog] = useState({ open: false, url: "", title: "" })
  const [deletingAssetId, setDeletingAssetId] = useState(null)
  const [selectedAssetKeys, setSelectedAssetKeys] = useState([])
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState({ total: 0, processed: 0 })
  /** Paginate large asset tables so the page stays responsive after load. */
  const ASSETS_PAGE_SIZE = 50
  const [assetsPage, setAssetsPage] = useState(0)
  const [editAssetDialog, setEditAssetDialog] = useState({
    open: false,
    asset: null,
    formValues: {},
    fieldTypes: {},
  })
  const [singleAssetForm, setSingleAssetForm] = useState({
    brand: "",
    system: "",
    category: "",
    systems: [],
    subsystems: [],
    subSubsystems: [],
    itemType: "",
    description: "",
    model: "",
    partNumber: "",
    deviceAddress: "",
  })
  const [singleAssetTechnicalProps, setSingleAssetTechnicalProps] = useState({})
  const [singleSystemSelect, setSingleSystemSelect] = useState("")
  const [singleCategorySelect, setSingleCategorySelect] = useState("")
  const [singleBrandSelect, setSingleBrandSelect] = useState("")
  const [brandRegistry, setBrandRegistry] = useState([])
  const docModalInputRef = useRef(null)
  const { toast } = useToast()
  const panelConnected = useFirePanelStore((s) => s.connected)
  const [isCollecting, setIsCollecting] = useState(false)
  const [isImportingSimplexText, setIsImportingSimplexText] = useState(false)
  const [simplexPasteOpen, setSimplexPasteOpen] = useState(false)
  const [simplexPasteText, setSimplexPasteText] = useState("")
  const [simplexTxtFileName, setSimplexTxtFileName] = useState("")
  const simplexFileInputRef = useRef(null)
  const canCollectAssets = panelConnected

  const parseExcelToObjects = (workbook, sheetName) => {
    if (!workbook || !sheetName) {
      return { headers: [], records: [] }
    }

    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) {
      return { headers: [], records: [] }
    }

    // Read as raw rows so we can detect the real header row
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" })
    if (!rows || rows.length === 0) {
      return { headers: [], records: [] }
    }

    // Find the header row - look for a row with multiple non-empty values
    let headerRowIndex = -1
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i]
      if (!Array.isArray(row)) continue
      
      const nonEmptyCount = row.filter((c) => String(c).trim() !== "").length
      if (nonEmptyCount >= 3) {
        headerRowIndex = i
        break
      }
    }

    if (headerRowIndex === -1) {
      // fallback: use first non-empty row as header
      const firstNonEmpty = rows.findIndex((row) => Array.isArray(row) && row.some((c) => String(c).trim() !== ""))
      if (firstNonEmpty === -1) return { headers: [], records: [] }
      headerRowIndex = firstNonEmpty
    }

    const allHeaders = rows[headerRowIndex].map((h) => String(h).trim()).filter((h) => h !== "")
    
    // Include all headers except "Sl No"
    const headers = allHeaders.filter((header) => {
      const fieldName = normalizeFieldName(header)
      return fieldName !== null // Exclude Sl No and similar columns
    })
    
    const records = []

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!Array.isArray(row)) continue

      // stop if completely empty
      const hasAnyValue = row.some((c) => {
        const val = String(c).trim()
        return val !== "" && val !== "undefined" && val !== "null"
      })
      if (!hasAnyValue) continue

      const obj = {}
      // Include all fields (except Sl No)
      headers.forEach((h) => {
        const headerIndex = allHeaders.indexOf(h)
        const value = headerIndex >= 0 && row[headerIndex] !== undefined && row[headerIndex] !== null 
          ? String(row[headerIndex]).trim() 
          : ""
        obj[h] = value
      })
      records.push(obj)
    }

    return { headers, records }
  }

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setFileName(selectedFile.name)
    setUploadSuccess(false)
    setPreviewData([])
    setPreviewHeaders([])
    setSelectedSheet("")
    setAssetImages({}) // Clear any uploaded images

    // Read Excel file and extract sheet names
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result)
        const wb = XLSX.read(data, { type: "array" })
        
        setWorkbook(wb)
        setSheetNames(wb.SheetNames)
        
        // Auto-select first sheet
        if (wb.SheetNames.length > 0) {
          const firstSheet = wb.SheetNames[0]
          setSelectedSheet(firstSheet)
          
          // Parse and preview first sheet
          const { headers, records } = parseExcelToObjects(wb, firstSheet)
          if (records.length > 0) {
            setPreviewHeaders(headers)
            setPreviewData(records)
          } else {
            setPreviewHeaders(headers)
            setPreviewData([])
          }
        }
      } catch (error) {
        console.error("Error parsing Excel file:", error)
        toast({
          title: "Error",
          description: "Failed to parse Excel file. Please check the file format.",
          variant: "destructive",
        })
      }
    }
    reader.readAsArrayBuffer(selectedFile)
  }

  const handleSheetChange = (sheetName) => {
    setSelectedSheet(sheetName)
    setUploadSuccess(false)
    setAssetImages({}) // Clear images when switching sheets
    
    if (!workbook) return

    try {
      const { headers, records } = parseExcelToObjects(workbook, sheetName)
      if (records.length > 0) {
        setPreviewHeaders(headers)
        setPreviewData(records)
      } else {
        setPreviewHeaders(headers)
        setPreviewData([])
      }
    } catch (error) {
      console.error("Error parsing sheet:", error)
      toast({
        title: "Error",
        description: "Failed to parse selected sheet.",
        variant: "destructive",
      })
    }
  }

  const handleImageUpload = async (rowIndex, file) => {
    if (!file) return

    // Validate file type
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload an image file (JPEG, PNG, GIF, or WebP)",
        variant: "destructive",
      })
      return
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      toast({
        title: "File Too Large",
        description: "Image size must be less than 5MB",
        variant: "destructive",
      })
      return
    }

    setUploadingImages((prev) => ({ ...prev, [rowIndex]: true }))

    try {
      // Create a unique filename
      const timestamp = Date.now()
      const fileName = `asset-preview-${rowIndex}-${timestamp}-${file.name}`
      const storageRef = ref(storage, `assets/preview-images/${fileName}`)

      // Upload the file
      await uploadBytes(storageRef, file)

      // Get the download URL
      const downloadURL = await getDownloadURL(storageRef)

      // Store the image URL
      setAssetImages((prev) => ({
        ...prev,
        [rowIndex]: {
          file,
          url: downloadURL,
          fileName: file.name,
        },
      }))

      toast({
        title: "Image Uploaded",
        description: "Asset image uploaded successfully",
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        title: "Upload Failed",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      })
    } finally {
      setUploadingImages((prev) => ({ ...prev, [rowIndex]: false }))
    }
  }

  const handleRemoveImage = (rowIndex) => {
    setAssetImages((prev) => {
      const updated = { ...prev }
      delete updated[rowIndex]
      return updated
    })
    toast({
      title: "Image Removed",
      description: "Asset image removed from preview",
    })
  }

  const handleSingleAssetFieldChange = (field, value) => {
    setSingleAssetForm((prev) => ({ ...prev, [field]: value }))
  }

  const getSystemOptionsForSingleAsset = useMemo(() => {
    const category = singleAssetForm.category.trim()
    if (!category) return []
    return SINGLE_ASSET_HIERARCHY.systemsByCategory[category] || []
  }, [singleAssetForm.category])

  const getSubsystemOptionsForSingleAsset = useMemo(() => {
    const selectedSystem = singleAssetForm.system || (singleAssetForm.systems || [])[0] || ""
    if (!selectedSystem) return []
    return SINGLE_ASSET_HIERARCHY.subsystemsBySystem[selectedSystem] || []
  }, [singleAssetForm.system, singleAssetForm.systems])

  const getSubSubsystemOptionsForSingleAsset = useMemo(() => {
    const selectedSubsystem = (singleAssetForm.subsystems || [])[0] || ""
    if (!selectedSubsystem) return []
    return SINGLE_ASSET_HIERARCHY.subSubsystemsBySubsystem[selectedSubsystem] || []
  }, [singleAssetForm.subsystems])

  const selectedTechnicalTemplateId = useMemo(
    () => getTechnicalTemplateId(singleAssetForm.category, singleAssetForm.system, singleAssetForm.itemType),
    [singleAssetForm.category, singleAssetForm.system, singleAssetForm.itemType],
  )

  const selectedTechnicalTemplate = useMemo(
    () => (selectedTechnicalTemplateId ? TECHNICAL_PROPERTY_TEMPLATES[selectedTechnicalTemplateId] : null),
    [selectedTechnicalTemplateId],
  )

  useEffect(() => {
    if (!selectedTechnicalTemplate) {
      setSingleAssetTechnicalProps({})
      return
    }

    const allowedFields = new Set(selectedTechnicalTemplate.fields)
    setSingleAssetTechnicalProps((prev) => {
      const next = {}
      Object.entries(prev).forEach(([key, value]) => {
        if (allowedFields.has(key)) {
          next[key] = value
        }
      })
      return next
    })
  }, [selectedTechnicalTemplate])

  const handleSingleAssetTechnicalPropChange = (field, value) => {
    setSingleAssetTechnicalProps((prev) => ({ ...prev, [field]: value }))
  }

  const resetSingleAssetForm = () => {
    setSingleAssetForm({
      brand: "",
      system: "",
      category: "",
      systems: [],
      subsystems: [],
      subSubsystems: [],
      itemType: "",
      description: "",
      model: "",
      partNumber: "",
      deviceAddress: "",
    })
    setSingleSystemSelect("")
    setSingleCategorySelect("")
    setSingleBrandSelect("")
    setSingleAssetTechnicalProps({})
  }

  // Fetch existing uploaded assets
  // Fetch existing uploaded assets (for a specific building). If no buildingName provided, fetch from global AssetsList.
  const fetchExistingAssets = async (buildingName = "") => {
    setIsLoadingExistingAssets(true)
    try {
      const assets = []
      if (!buildingName) {
        // global AssetsList fallback
        const assetsCollection = collection(db, "AssetsList")
        const q = query(assetsCollection, orderBy("createdAt", "desc"))
        const snapshot = await getDocs(q)
        snapshot.forEach((doc) => {
          assets.push({ id: doc.id, ...doc.data() })
        })
      } else {
        // fetch across known category keys under the building collection
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
        for (const categoryKey of categoryKeys) {
          try {
            const categoryCollection = collection(db, buildingName, "asset", categoryKey)
            const snapshot = await getDocs(query(categoryCollection, orderBy("createdAt", "desc")))
            snapshot.forEach((docSnap) => {
              assets.push({ id: docSnap.id, categoryKey, ...docSnap.data() })
            })
          } catch (err) {
            // ignore missing categories
          }
        }
      }

      setExistingAssets(assets)
    } catch (error) {
      console.error("Error fetching existing assets:", error)
      toast({
        title: "Error",
        description: "Failed to fetch existing assets",
        variant: "destructive",
      })
    } finally {
      setIsLoadingExistingAssets(false)
    }
  }

  // Get unique values for filters (memoized — scanning all assets every render is slow).
  const uniqueBrandOptions = useMemo(() => {
    const values = new Set()
    existingAssets.forEach((asset) => {
      const value = asset.brand
      if (value && String(value).trim() !== "" && value !== "-") values.add(value)
    })
    return Array.from(values).sort()
  }, [existingAssets])

  const uniqueCategoryOptions = useMemo(() => {
    const values = new Set()
    existingAssets.forEach((asset) => {
      const value = asset.category
      if (value && String(value).trim() !== "" && value !== "-") values.add(value)
    })
    return Array.from(values).sort()
  }, [existingAssets])

  const uniqueSystemOptions = useMemo(() => {
    const values = new Set()
    existingAssets.forEach((asset) => {
      const value = asset.system
      if (value && String(value).trim() !== "" && value !== "-") values.add(value)
    })
    return Array.from(values).sort()
  }, [existingAssets])

  // Are the loaded assets stored under building collection (have buildingAssetId)?
  const isBuildingAsset = useMemo(
    () => existingAssets.some((a) => !!a.buildingAssetId),
    [existingAssets],
  )
  const singleCategoryOptions = SINGLE_ASSET_HIERARCHY.categories
  const singleSystemOptions = useMemo(() => {
    return getSystemOptionsForSingleAsset
  }, [getSystemOptionsForSingleAsset])

  const singleItemTypeOptions = useMemo(() => {
    if (!singleAssetForm.category.trim() || !singleAssetForm.system.trim() || !singleAssetForm.brand.trim()) return []
    return Array.from(
      new Set(
        existingAssets
          .filter((asset) => {
            return (
              (asset.category || "").trim() === singleAssetForm.category.trim() &&
              (asset.system || "").trim() === singleAssetForm.system.trim() &&
              (asset.brand || "").trim() === singleAssetForm.brand.trim()
            )
          })
          .map((asset) => (asset.itemType || "").trim())
          .filter((value) => value && value !== "-"),
      ),
    ).sort()
  }, [existingAssets, singleAssetForm.category, singleAssetForm.system, singleAssetForm.brand])
  const singleBrandOptions = useMemo(
    () =>
      getBrandOptionsFromRegistry(brandRegistry, {
        category: singleAssetForm.category,
        system: singleAssetForm.system || (singleAssetForm.systems?.[0] || ""),
      }),
    [brandRegistry, singleAssetForm.category, singleAssetForm.system, singleAssetForm.systems],
  )

  // Filter assets based on search and filters
  const getAssetRowKey = (asset) =>
    `${asset.id || asset.assetId || asset.buildingAssetId || "unknown"}::${asset.categoryKey || "global"}`

  const filteredAssets = useMemo(() => {
    return existingAssets.filter((asset) => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        const matchesSearch =
          (asset.assetId || "").toLowerCase().includes(searchLower) ||
          (asset.brand || "").toLowerCase().includes(searchLower) ||
          (asset.system || "").toLowerCase().includes(searchLower) ||
          (asset.category || "").toLowerCase().includes(searchLower) ||
          (asset.description || "").toLowerCase().includes(searchLower) ||
          (resolveAssetDeviceAddress(asset) || "").toLowerCase().includes(searchLower) ||
          (asset.deviceAddress || "").toLowerCase().includes(searchLower) ||
          (asset.partNumber || "").toLowerCase().includes(searchLower) ||
          (asset.deviceLocation || "").toLowerCase().includes(searchLower)
        if (!matchesSearch) return false
      }

      if (filterBrand !== "all" && asset.brand !== filterBrand) return false
      if (filterCategory !== "all" && asset.category !== filterCategory) return false
      if (filterSystem !== "all" && asset.system !== filterSystem) return false

      return true
    })
  }, [existingAssets, searchTerm, filterBrand, filterCategory, filterSystem])

  // Keep selection lookups O(1) while rendering large tables.
  const selectedAssetKeySet = useMemo(() => new Set(selectedAssetKeys), [selectedAssetKeys])

  const selectedCount = selectedAssetKeys.length
  const allFilteredSelected =
    filteredAssets.length > 0 &&
    filteredAssets.every((asset) => selectedAssetKeySet.has(getAssetRowKey(asset)))

  // Paginate the assets table — rendering thousands of rows freezes typing/selects.
  const totalAssetPages = Math.max(1, Math.ceil(filteredAssets.length / ASSETS_PAGE_SIZE))

  useEffect(() => {
    // Reset to first page when filters/search change or list shrinks.
    setAssetsPage(0)
  }, [searchTerm, filterBrand, filterCategory, filterSystem, existingAssets.length])

  useEffect(() => {
    if (assetsPage > totalAssetPages - 1) {
      setAssetsPage(Math.max(0, totalAssetPages - 1))
    }
  }, [assetsPage, totalAssetPages])

  const pagedAssets = useMemo(() => {
    const start = assetsPage * ASSETS_PAGE_SIZE
    return filteredAssets.slice(start, start + ASSETS_PAGE_SIZE)
  }, [filteredAssets, assetsPage])
  const toggleAssetSelection = (asset, checked) => {
    const key = getAssetRowKey(asset)
    setSelectedAssetKeys((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key]
      return prev.filter((item) => item !== key)
    })
  }

  const toggleSelectAllFiltered = (checked) => {
    const filteredKeys = filteredAssets.map(getAssetRowKey)
    if (!checked) {
      setSelectedAssetKeys((prev) => prev.filter((key) => !filteredKeys.includes(key)))
      return
    }
    setSelectedAssetKeys((prev) => [...new Set([...prev, ...filteredKeys])])
  }

  const deleteAssetStorageFiles = async (assets) => {
    const storagePaths = assets.flatMap((asset) =>
      Object.values(DOC_TYPE_DEFS)
        .map((def) => asset[def.storagePathField])
        .filter(Boolean),
    )

    const chunkSize = 20
    for (let i = 0; i < storagePaths.length; i += chunkSize) {
      const chunk = storagePaths.slice(i, i + chunkSize)
      await Promise.allSettled(
        chunk.map((path) => {
          try {
            return deleteObject(ref(storage, path))
          } catch {
            return null
          }
        }),
      )
    }
  }

  const deleteAssetRecord = async (asset) => {
    const docRef = getAssetDocRef(asset)
    await deleteDoc(docRef)
    await deleteAssetStorageFiles([asset])
  }

  const deleteAssetRecordsBatch = async (assets, onProgress) => {
    const BATCH_SIZE = 500
    const deletedAssets = []
    let failedCount = 0

    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      const chunk = assets.slice(i, i + BATCH_SIZE)
      try {
        const docRefs = chunk.map((asset) => getAssetDocRef(asset))
        await deleteDocsBatch(docRefs)
        deletedAssets.push(...chunk)
      } catch (err) {
        console.error("Bulk delete batch error:", err)
        failedCount += chunk.length
      }

      onProgress?.({
        total: assets.length,
        processed: Math.min(i + chunk.length, assets.length),
      })
    }

    if (deletedAssets.length > 0) {
      await deleteAssetStorageFiles(deletedAssets)
    }

    return { deletedAssets, failedCount }
  }

  // Handle image selection for existing assets
  const handleExistingAssetImageSelect = async (assetId, file) => {
    // Validate file
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please select a JPEG, PNG, GIF, or WebP image",
        variant: "destructive",
      })
      return
    }

    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      toast({
        title: "File Too Large",
        description: "Image size must be less than 5MB",
        variant: "destructive",
      })
      return
    }

    // Set uploading state
    setPendingImageUploads((prev) => ({
      ...prev,
      [assetId]: { file, url: null, uploading: true },
    }))

    try {
      // Create a unique filename
      const timestamp = Date.now()
      const fileName = `asset-${assetId}-${timestamp}-${file.name}`
      const storageRef = ref(storage, `assets/images/${fileName}`)

      // Upload the file
      await uploadBytes(storageRef, file)

      // Get the download URL
      const downloadURL = await getDownloadURL(storageRef)

      // Update pending uploads with URL
      setPendingImageUploads((prev) => ({
        ...prev,
        [assetId]: { file, url: downloadURL, uploading: false },
      }))

      toast({
        title: "Image Ready",
        description: "Image uploaded. Click Save to update the asset.",
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        title: "Upload Failed",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      })
      // Remove failed upload
      setPendingImageUploads((prev) => {
        const updated = { ...prev }
        delete updated[assetId]
        return updated
      })
    }
  }

  // Save all pending image uploads to Firestore
  const handleSaveImages = async () => {
    const pendingCount = Object.keys(pendingImageUploads).length
    if (pendingCount === 0) {
      toast({
        title: "No Changes",
        description: "No images to save",
      })
      return
    }

    setIsSavingImages(true)
    try {
      const assetsCollection = collection(db, "AssetsList")
      const pendingUploadsCopy = { ...pendingImageUploads } // Copy before clearing

      // Update each asset with its new image URL
      const updatePromises = Object.entries(pendingUploadsCopy).map(async ([assetId, uploadData]) => {
        if (!uploadData.url) return // Skip if no URL (upload failed)

        const assetDocRef = doc(assetsCollection, assetId)
        await updateDoc(assetDocRef, {
          customImageUrl: uploadData.url,
          updatedAt: new Date().toISOString(),
        })
      })

      await Promise.all(updatePromises)

      // Update local state
      setExistingAssets((prev) =>
        prev.map((asset) => {
          const uploadData = pendingUploadsCopy[asset.id]
          if (uploadData && uploadData.url) {
            return { ...asset, customImageUrl: uploadData.url }
          }
          return asset
        })
      )

      // Clear pending uploads
      setPendingImageUploads({})

      toast({
        title: "Success",
        description: `Successfully updated ${pendingCount} asset image(s)`,
      })
    } catch (error) {
      console.error("Error saving images:", error)
      toast({
        title: "Error",
        description: "Failed to save images. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSavingImages(false)
    }
  }

  const DOC_TYPE_DEFS = {
    dataSheet: {
      label: "Data Sheet",
      urlField: "dataSheetUrl",
      storagePathField: "dataSheetStoragePath",
    },
    brochure: {
      label: "Brochure",
      urlField: "brochureUrl",
      storagePathField: "brochureStoragePath",
    },
    installationGuide: {
      label: "Installation Guide",
      urlField: "installationGuideUrl",
      storagePathField: "installationGuideStoragePath",
    },
    operationGuide: {
      label: "Operation Guide",
      urlField: "operationGuideUrl",
      storagePathField: "operationGuideStoragePath",
    },
    brochurePdf: {
      label: "Brochure PDF",
      urlField: "brochurePdfUrl",
      storagePathField: "brochurePdfStoragePath",
    },
  }

  const getAssetDocRef = (asset) => {
    // Building assets live inside: /{buildingName}/asset/{categoryKey}/{docId}
    if ((asset?.buildingAssetId || asset?.categoryKey) && selectedBuildingName) {
      const categoryKey = asset.categoryKey
      if (!categoryKey) throw new Error("Missing categoryKey for building asset")
      const assetsCollection = collection(db, selectedBuildingName, "asset", categoryKey)
      return doc(assetsCollection, asset.id)
    }

    // Global assets live inside: /AssetsList/{docId}
    return doc(collection(db, "AssetsList"), asset.id)
  }

  const openDocPreview = (url, title) => {
    if (!url) return
    setDocPreviewDialog({ open: true, url, title })
  }

  const handleDocUpload = async (assetLike, docTypeKey, file) => {
    const typeDef = DOC_TYPE_DEFS[docTypeKey]
    if (!typeDef) throw new Error("Unsupported doc type")

    // Currently we accept PDF uploads for previewing inside the app.
    const isPdf = file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf")
    if (!isPdf) {
      toast({
        title: "Invalid File Type",
        description: "Please upload a PDF file.",
        variant: "destructive",
      })
      return false
    }

    // Validate file size (max 20MB)
    const maxSize = 20 * 1024 * 1024
    if (file.size > maxSize) {
      toast({
        title: "File Too Large",
        description: "File size must be less than 20MB",
        variant: "destructive",
      })
      return false
    }

    setUploadingDocTypes((prev) => ({
      ...prev,
      [assetLike.id]: { ...(prev[assetLike.id] || {}), [docTypeKey]: true },
    }))

    try {
      const timestamp = Date.now()
      const storageRef = ref(
        storage,
        `assets/docs/${assetLike.id}/${docTypeKey}/${timestamp}-${file.name}`
      )

      await uploadBytes(storageRef, file)
      const downloadURL = await getDownloadURL(storageRef)
      const matchedAsset = existingAssets.find(
        (a) =>
          a.id === assetLike.id &&
          (assetLike.categoryKey ? a.categoryKey === assetLike.categoryKey : true)
      )
      const existingDocuments = Array.isArray(matchedAsset?.documents) ? matchedAsset.documents : []
      const nextDocument = {
        type: docTypeKey,
        label: typeDef.label,
        url: downloadURL,
        fileName: file.name,
        storagePath: storageRef.fullPath,
        uploadedAt: new Date().toISOString(),
      }
      const updatedDocuments = [
        ...existingDocuments.filter((docItem) => docItem?.type !== docTypeKey),
        nextDocument,
      ]

      const docRef = getAssetDocRef(assetLike)
      await updateDoc(docRef, {
        [typeDef.urlField]: downloadURL,
        [typeDef.storagePathField]: storageRef.fullPath,
        documents: updatedDocuments,
        updatedAt: new Date().toISOString(),
      })

      setExistingAssets((prev) =>
        prev.map((a) => {
          if (a.id !== assetLike.id) return a
          return {
            ...a,
            [typeDef.urlField]: downloadURL,
            [typeDef.storagePathField]: storageRef.fullPath,
            documents: updatedDocuments,
          }
        })
      )

      toast({
        title: "Upload Successful",
        description: `${typeDef.label} uploaded for this asset.`,
      })
      return true
    } catch (err) {
      console.error("Doc upload error:", err)
      toast({
        title: "Upload Failed",
        description: "Failed to upload the document. Please try again.",
        variant: "destructive",
      })
      return false
    } finally {
      setUploadingDocTypes((prev) => ({
        ...prev,
        [assetLike.id]: { ...(prev[assetLike.id] || {}), [docTypeKey]: false },
      }))
    }
  }

  const openDocUploadModal = (asset, docTypeKey) => {
    setDocUploadModal({
      assetId: asset.id,
      docTypeKey,
      categoryKey: asset.categoryKey,
      buildingAssetId: asset.buildingAssetId,
    })
    setDocDragActive(false)
  }

  const handleModalDocFile = async (file) => {
    if (!docUploadModal || !file) return
    const { assetId, docTypeKey, categoryKey, buildingAssetId } = docUploadModal
    const assetLike = { id: assetId, categoryKey, buildingAssetId }
    const ok = await handleDocUpload(assetLike, docTypeKey, file)
    if (ok) {
      setDocUploadModal(null)
      setDocDragActive(false)
      if (docModalInputRef.current) docModalInputRef.current.value = ""
    }
  }

  const handleDeleteAsset = async (asset) => {
    try {
      setDeletingAssetId(asset.id)

      const confirmed = window.confirm(`Are you sure you want to delete "${asset.assetId || asset.buildingAssetId || asset.id}"?`)
      if (!confirmed) return

      await deleteAssetRecord(asset)

      const rowKey = getAssetRowKey(asset)
      setExistingAssets((prev) =>
        prev.filter((a) => getAssetRowKey(a) !== rowKey),
      )
      setSelectedAssetKeys((prev) => prev.filter((key) => key !== rowKey))

      toast({
        title: "Asset Deleted",
        description: "The asset and its document links were removed.",
      })
    } catch (err) {
      console.error("Delete asset error:", err)
      toast({
        title: "Delete Failed",
        description: "Failed to delete the asset. Please try again.",
        variant: "destructive",
      })
    } finally {
      setDeletingAssetId(null)
    }
  }

  const handleBulkDeleteSelected = async () => {
    const selectedAssets = filteredAssets.filter((asset) =>
      selectedAssetKeys.includes(getAssetRowKey(asset)),
    )
    if (selectedAssets.length === 0) return

    const confirmed = window.confirm(
      `Delete ${selectedAssets.length} selected asset(s)? This cannot be undone.`,
    )
    if (!confirmed) return

    setIsBulkDeleting(true)
    setBulkDeleteProgress({ total: selectedAssets.length, processed: 0 })
    let successCount = 0
    let errorCount = 0
    const deletedKeys = new Set()

    try {
      const { deletedAssets, failedCount } = await deleteAssetRecordsBatch(
        selectedAssets,
        setBulkDeleteProgress,
      )
      deletedAssets.forEach((asset) => {
        deletedKeys.add(getAssetRowKey(asset))
        successCount++
      })
      errorCount = failedCount
    } catch (err) {
      console.error("Bulk delete asset error:", err)
      toast({
        title: "Bulk Delete Failed",
        description: err.message || "Failed to delete selected assets. Please try again.",
        variant: "destructive",
      })
    }

    if (deletedKeys.size > 0) {
      setExistingAssets((prev) => prev.filter((asset) => !deletedKeys.has(getAssetRowKey(asset))))
      setSelectedAssetKeys((prev) => prev.filter((key) => !deletedKeys.has(key)))
    }

    if (successCount > 0 || errorCount === 0) {
      toast({
        title: "Bulk Delete Complete",
        description: `Deleted ${successCount} asset(s)${errorCount > 0 ? `, ${errorCount} failed` : ""}.`,
        variant: errorCount > 0 ? "destructive" : "default",
      })
    }
    setBulkDeleteProgress({ total: 0, processed: 0 })
    setIsBulkDeleting(false)
  }

  const openEditAssetDialog = (asset) => {
    const commonEditable = new Set([
      "brand",
      "system",
      "category",
      "itemType",
      "description",
      "model",
      "partNumber",
      "partModelNumber",
      "assetName",
      "assetCategory",
      "mainCategory",
      "deviceLocation",
      "deviceAddress",
      "manufacturer",
      "supplier",
      "made",
      "leadTime",
      "warranty",
      "technicalProperties",
      "logs",
    ])

    const nonEditable = new Set([
      "id",
      "categoryKey",
      "assetId",
      "buildingAssetId",
      "createdAt",
      "updatedAt",
      "rowNumber",
      "customImageUrl",
      "documents",
      "dataSheetUrl",
      "brochureUrl",
      "installationGuideUrl",
      "operationGuideUrl",
      "brochurePdfUrl",
      "dataSheetStoragePath",
      "brochureStoragePath",
      "installationGuideStoragePath",
      "operationGuideStoragePath",
      "brochurePdfStoragePath",
      "sourceDocument",
      "transferredAt",
    ])

    const allowedKeys = Object.keys(asset || {}).filter(
      (key) => !nonEditable.has(key) && commonEditable.has(key),
    )
    const formValues = {}
    const fieldTypes = {}

    allowedKeys.forEach((key) => {
      const value = asset[key]

      if (Array.isArray(value)) {
        fieldTypes[key] = "array"
        formValues[key] = JSON.stringify(value, null, 2)
      } else if (value && typeof value === "object") {
        fieldTypes[key] = "object"
        formValues[key] = JSON.stringify(value, null, 2)
      } else if (typeof value === "number") {
        fieldTypes[key] = "number"
        formValues[key] = String(value)
      } else if (typeof value === "boolean") {
        fieldTypes[key] = "boolean"
        formValues[key] = value ? "true" : "false"
      } else {
        fieldTypes[key] = "string"
        formValues[key] = value == null ? "" : String(value)
      }
    })

    setEditAssetDialog({
      open: true,
      asset,
      formValues,
      fieldTypes,
    })
  }

  const handleEditAssetFieldChange = (key, value) => {
    setEditAssetDialog((prev) => ({
      ...prev,
      formValues: {
        ...prev.formValues,
        [key]: value,
      },
    }))
  }

  const handleSaveEditedAsset = async () => {
    const asset = editAssetDialog.asset
    if (!asset) return

    try {
      const payload = {}
      Object.entries(editAssetDialog.formValues).forEach(([key, rawValue]) => {
        const fieldType = editAssetDialog.fieldTypes[key] || "string"
        const value = String(rawValue ?? "").trim()

        if ((fieldType === "array" || fieldType === "object") && value) {
          payload[key] = JSON.parse(value)
          return
        }
        if (fieldType === "array") {
          payload[key] = []
          return
        }
        if (fieldType === "object") {
          payload[key] = {}
          return
        }
        if (fieldType === "number") {
          payload[key] = value === "" ? 0 : Number(value)
          return
        }
        if (fieldType === "boolean") {
          payload[key] = value.toLowerCase() === "true"
          return
        }
        payload[key] = rawValue
      })

      payload.updatedAt = new Date().toISOString()

      const docRef = getAssetDocRef(asset)
      await updateDoc(docRef, payload)

      setExistingAssets((prev) =>
        prev.map((a) => {
          const isSameAsset =
            a.id === asset.id && (a.categoryKey || null) === (asset.categoryKey || null)
          if (!isSameAsset) return a
          return { ...a, ...payload }
        }),
      )

      setEditAssetDialog({ open: false, asset: null, formValues: {}, fieldTypes: {} })
      toast({
        title: "Asset Updated",
        description: "Selected item fields were updated successfully.",
      })
    } catch (error) {
      toast({
        title: "Update Failed",
        description:
          error?.message ||
          "Could not update this item. For object/array fields, make sure JSON is valid.",
        variant: "destructive",
      })
    }
  }

  useEffect(() => {
    if (!isReady || selectedCommunityId) return
    if (communities.length === 1) {
      const c = communities[0]
      setSelectedCommunityId(c.id || c.communityName)
      const blds = (c.buildings || []).map((b) => ({ id: b, name: b }))
      setBuildings(blds)
    }
  }, [isReady, communities, selectedCommunityId])

  useEffect(() => {
    const loadBrand = async () => {
      try {
        const rows = await loadBrandRegistry(db, getDocs, collection)
        setBrandRegistry(rows)
      } catch (brandError) {
        console.warn("Brand registry load failed:", brandError)
        setBrandRegistry([])
      }
    }
    loadBrand()
    fetchExistingAssets()
  }, [])

  // When user selects a building, fetch assets for that building
  useEffect(() => {
    if (selectedBuildingName) {
      fetchExistingAssets(selectedBuildingName)
    }
  }, [selectedBuildingName])

  const processExcelData = (jsonData, existingAssetCount = 0) => {
    if (!jsonData || jsonData.length === 0) {
      throw new Error("Excel file is empty or has no data")
    }

    const processedAssets = []
    
    // Get headers from first row
    const headers = Object.keys(jsonData[0])
    
    // Create column mapping for all fields (except Sl No)
    const columnMap = {}
    headers.forEach((header) => {
      const fieldName = normalizeFieldName(header)
      if (fieldName) {
        columnMap[header] = fieldName
      }
    })

    // Process each row - save all fields
    jsonData.forEach((row, index) => {
      const now = new Date().toISOString()
      const asset = {
        createdAt: now,
        updatedAt: now,
        rowNumber: index + 2, // Excel row number (1-indexed, +1 for header)
      }

      // Map all columns to fields
      headers.forEach((header) => {
        const value = row[header]
        const fieldName = columnMap[header]
        
        // Save all fields (except those filtered out by normalizeFieldName)
        if (fieldName) {
          // Handle empty values - always use empty string
          if (value === undefined || value === null || value === "" || value === "undefined" || value === "null") {
            asset[fieldName] = "" // Use empty string for all empty fields
          } else {
            asset[fieldName] = String(value).trim()
          }
        }
      })

      // Generate assetId from brand, system, itemType
      // Look for these fields with various possible names
      const brand = asset.brand || asset.brandName || asset.manufacturer || asset.manufacturerName || ""
      const system = asset.system || asset.systemType || asset.systemName || ""
      const itemType = asset.itemType || asset.type || asset.category || asset.assetType || ""
      
      asset.assetId = generateAssetId(brand, system, itemType, existingAssetCount + index + 1)

      // Only add asset if it has at least one non-empty field (besides metadata fields)
      const metadataFields = ["createdAt", "updatedAt", "rowNumber", "assetId"]
      const hasData = Object.keys(asset).some((key) => {
        if (metadataFields.includes(key)) return false
        return asset[key] !== ""
      })
      
      if (hasData) {
        processedAssets.push(asset)
      }
    })

    return processedAssets
  }

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: "File Required",
        description: "Please select an Excel file to upload",
        variant: "destructive",
      })
      return
    }

    if (!selectedSheet) {
      toast({
        title: "Sheet Required",
        description: "Please select a sheet to upload",
        variant: "destructive",
      })
      return
    }

    if (!workbook) {
      toast({
        title: "Error",
        description: "Workbook not loaded. Please select a file again.",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setUploadSuccess(false)

    try {
      const { records } = parseExcelToObjects(workbook, selectedSheet)

      // Check for existing assets in Firestore
      const assetsCollection = collection(db, "AssetsList")
      const existingAssetsSnapshot = await getDocs(assetsCollection)
      
      // Get the count of existing assets for index continuation
      const existingAssetCount = existingAssetsSnapshot.size
      
      // Process the data with existing asset count for proper indexing
      const processedAssets = processExcelData(records, existingAssetCount)

      if (processedAssets.length === 0) {
        throw new Error("No valid assets found in the selected sheet")
      }

      // Add image URLs to assets that have images uploaded
      processedAssets.forEach((asset, index) => {
        if (assetImages[index]) {
          asset.customImageUrl = assetImages[index].url
        } else {
          asset.customImageUrl = "" // Empty string for assets without images
        }
      })

      setUploadProgress({ total: processedAssets.length, processed: 0 })
      
      // Create a set of existing assetIds for duplicate checking
      const existingAssetIds = new Set()
      
      existingAssetsSnapshot.forEach((doc) => {
        const data = doc.data()
        if (data.assetId) {
          existingAssetIds.add(data.assetId.toLowerCase())
        }
      })

      // Filter out assets that already exist (by assetId)
      const newAssets = processedAssets.filter((asset) => {
        if (!asset.assetId) return true // Include assets without assetId
        return !existingAssetIds.has(asset.assetId.toLowerCase())
      })

      const skippedCount = processedAssets.length - newAssets.length

      if (newAssets.length === 0) {
        toast({
          title: "No New Assets",
          description: `All ${processedAssets.length} assets already exist in the database. No new assets to upload.`,
          variant: "default",
        })
        setIsLoading(false)
        setUploadProgress({ total: 0, processed: 0 })
        return
      }

      setUploadProgress({ total: newAssets.length, processed: 0 })

      let successCount = 0
      let errorCount = 0

      // Save in batches — one DB request per batch (no parallel addDoc races)
      const batchSize = 25
      for (let i = 0; i < newAssets.length; i += batchSize) {
        const batch = newAssets.slice(i, i + batchSize)
        try {
          await addDocsBatch(
            assetsCollection,
            batch.map((asset) => ({
              ...asset,
              logs: Array.isArray(asset.logs) ? asset.logs : [],
            })),
          )
          successCount += batch.length
        } catch (error) {
          console.error(`Error uploading asset batch at rows ${i + 1}-${i + batch.length}:`, error)
          errorCount += batch.length
        }

        setUploadProgress({ total: newAssets.length, processed: Math.min(i + batchSize, newAssets.length) })
      }

      setUploadSummary({ success: successCount, skipped: skippedCount, errors: errorCount })
      setUploadSuccess(true)
      const message = `Successfully uploaded ${successCount} new assets from sheet "${selectedSheet}"${skippedCount > 0 ? `, skipped ${skippedCount} duplicates` : ""}${errorCount > 0 ? ` (${errorCount} errors)` : ""}.`
      toast({
        title: "Upload Complete",
        description: message,
      })

          // Clear file input
          if (fileInputRef.current) {
            fileInputRef.current.value = ""
          }
          setFile(null)
          setFileName("")
          setPreviewData([])
          setPreviewHeaders([])
          setSheetNames([])
          setSelectedSheet("")
          setWorkbook(null)
          setAssetImages({}) // Clear uploaded images
          setUploadSummary({ success: 0, skipped: 0, errors: 0 })
          
          // Refresh existing assets list
          fetchExistingAssets()
    } catch (error) {
      console.error("Error uploading assets:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to upload assets",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setUploadProgress({ total: 0, processed: 0 })
    }
  }

  const handleCollectAssets = async () => {
    if (!canCollectAssets) {
      toast({
        title: "Cannot collect assets",
        description: "Connect to the fire panel on the Network page first.",
        variant: "destructive",
      })
      return
    }

    setIsCollecting(true)
    setUploadSuccess(false)

    try {
      const res = await apiFetch("/api/telnet/fire-panel/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "cshow *", timeoutMs: CSHOW_COLLECT_TIMEOUT_MS }),
      })
      const contentType = res.headers.get("content-type") || ""
      const data = contentType.includes("application/json")
        ? await res.json()
        : { error: await res.text() }
      if (!res.ok) {
        throw new Error(
          data.error ||
            (res.status === 503
              ? "Local API server is not running. Start it with: npm run desktop:dev"
              : "Panel command failed"),
        )
      }

      await runSimplexTextImport(data.response || "", "panel")
    } catch (error) {
      console.error("Collect assets error:", error)
      toast({
        title: "Collect failed",
        description: error.message || "Failed to collect assets from panel",
        variant: "destructive",
      })
    } finally {
      setIsCollecting(false)
      setIsLoading(false)
      setUploadProgress({ total: 0, processed: 0 })
    }
  }

  const runSimplexTextImport = async (text, sourceLabel = "file") => {
    const trimmed = String(text || "").trim()
    if (!trimmed) {
      toast({
        title: "No content",
        description: "Paste or upload panel export text (cshow * output).",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setUploadSuccess(false)

    const devices = parseSimplexFile(trimmed)
    if (devices.length === 0) {
      toast({
        title: "No devices found",
        description: "No M-devices were parsed. Use Simplex cshow * export text.",
        variant: "destructive",
      })
      setIsLoading(false)
      return
    }

    setUploadProgress({ total: 0, processed: 0 })
    const result = await importSimplexDevicesToAssetsList(devices, setUploadProgress)

    if (result.empty) {
      toast({
        title: "No new assets",
        description: `Parsed ${result.parsedCount} devices but all were skipped (duplicates or missing address).`,
      })
      setIsLoading(false)
      setUploadProgress({ total: 0, processed: 0 })
      return
    }

    setUploadSummary({
      success: result.successCount,
      skipped: result.skippedCount,
      errors: result.errorCount,
    })
    setUploadSuccess(true)
    fetchExistingAssets()

    const sourceName =
      sourceLabel === "panel"
        ? "panel"
        : sourceLabel === "paste"
          ? "pasted text"
          : simplexTxtFileName || "TXT file"

    toast({
      title: "Import complete",
      description: `Added ${result.successCount} assets from ${sourceName}${result.skippedCount > 0 ? `, skipped ${result.skippedCount}` : ""}${result.errorCount > 0 ? ` (${result.errorCount} errors)` : ""}.`,
    })

    setIsLoading(false)
    setUploadProgress({ total: 0, processed: 0 })
  }

  const handleImportSimplexTxtFile = async (event) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ""
    if (!selectedFile) return

    setIsImportingSimplexText(true)
    setSimplexTxtFileName(selectedFile.name)

    try {
      const text = await selectedFile.text()
      await runSimplexTextImport(text, "file")
    } catch (error) {
      console.error("Simplex TXT import error:", error)
      toast({
        title: "Import failed",
        description: error.message || "Could not read the text file.",
        variant: "destructive",
      })
    } finally {
      setIsImportingSimplexText(false)
    }
  }

  const handleImportSimplexPaste = async () => {
    setIsImportingSimplexText(true)
    try {
      await runSimplexTextImport(simplexPasteText, "paste")
      setSimplexPasteOpen(false)
      setSimplexPasteText("")
    } catch (error) {
      console.error("Simplex paste import error:", error)
      toast({
        title: "Import failed",
        description: error.message || "Could not import pasted text.",
        variant: "destructive",
      })
    } finally {
      setIsImportingSimplexText(false)
    }
  }

  const handleSingleAssetUpload = async () => {
    const category = singleAssetForm.category.trim()
    const brand = singleAssetForm.brand.trim()
    const selectedSystems = Array.isArray(singleAssetForm.systems) ? singleAssetForm.systems : []
    const system = (selectedSystems[0] || singleAssetForm.system || "").trim()
    const itemType = singleAssetForm.itemType.trim()

    if (!category || !brand || !system || !itemType || selectedSystems.length === 0) {
      toast({
        title: "Missing Required Fields",
        description: "Category, System, Brand, and Item Type are required for single asset upload.",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setUploadSuccess(false)

    try {
      const assetsCollection = collection(db, "AssetsList")
      // Use already-loaded assets for id generation (avoid a full Firestore re-read).
      const existingAssetIds = new Set(
        existingAssets
          .map((asset) => String(asset.assetId || "").trim().toLowerCase())
          .filter(Boolean),
      )
      let sequence = existingAssets.length + 1
      let assetId = generateAssetId(brand, system, itemType, sequence)
      // Bump sequence if this generated id already exists in memory.
      while (existingAssetIds.has(assetId.toLowerCase()) && sequence < existingAssets.length + 1000) {
        sequence += 1
        assetId = generateAssetId(brand, system, itemType, sequence)
      }

      if (existingAssetIds.has(assetId.toLowerCase())) {
        toast({
          title: "Duplicate Asset",
          description: `Asset with ID "${assetId}" already exists.`,
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      const now = new Date().toISOString()
      const cleanedTechnicalValues = Object.fromEntries(
        Object.entries(singleAssetTechnicalProps).filter(([, value]) => String(value || "").trim() !== ""),
      )
      const deviceAddress = singleAssetForm.deviceAddress.trim()
      const payload = {
        assetId,
        brand,
        system,
        category: singleAssetForm.category.trim(),
        systems: selectedSystems,
        subsystems: singleAssetForm.subsystems || [],
        subSubsystems: singleAssetForm.subSubsystems || [],
        itemType,
        description: singleAssetForm.description.trim(),
        model: singleAssetForm.model.trim(),
        partNumber: singleAssetForm.partNumber.trim(),
        deviceAddress,
        technicalProperties: {
          templateId: selectedTechnicalTemplateId || "",
          templateName: selectedTechnicalTemplate?.label || "",
          values: cleanedTechnicalValues,
        },
        logs: [],
        customImageUrl: "",
        createdAt: now,
        updatedAt: now,
        rowNumber: 0,
      }

      await addDoc(assetsCollection, payload)

      setUploadSummary({ success: 1, skipped: 0, errors: 0 })
      setUploadSuccess(true)
      resetSingleAssetForm()
      fetchExistingAssets()

      toast({
        title: "Upload Complete",
        description: `Single asset uploaded successfully with ID "${assetId}".`,
      })
    } catch (error) {
      console.error("Error uploading single asset:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to upload single asset",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setUploadProgress({ total: 0, processed: 0 })
    }
  }

  const docModalUploading =
    !!docUploadModal &&
    !!uploadingDocTypes[docUploadModal.assetId]?.[docUploadModal.docTypeKey]

  return (
    <DashboardHeader>
<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <PageHelpBanner />
          <Card className="shadow-md">
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                Upload Assets
                <FaqHelpButton articleId="page-assets-upload" />
                <FaqHelpButton articleId="as-upload" />
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="upload-mode" className="text-xs">Upload Mode</Label>
                  <Select value={uploadMode} onValueChange={setUploadMode}>
                    <SelectTrigger id="upload-mode" className="h-9 text-xs max-w-xs">
                      <SelectValue placeholder="Select upload mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bulk" className="text-xs">Bulk (Excel)</SelectItem>
                      <SelectItem value="single" className="text-xs">Single Asset</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCollectAssets}
                    disabled={isLoading || isCollecting || isImportingSimplexText || !canCollectAssets}
                    className="h-9 text-xs flex items-center gap-2"
                  >
                    {isCollecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Package className="h-3.5 w-3.5" />
                    )}
                    {isCollecting ? "Collecting..." : "Collect Assets"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => simplexFileInputRef.current?.click()}
                    disabled={isLoading || isCollecting || isImportingSimplexText}
                    className="h-9 text-xs flex items-center gap-2"
                  >
                    {isImportingSimplexText ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    {isImportingSimplexText && simplexTxtFileName
                      ? "Importing..."
                      : "Import TXT File"}
                  </Button>
                  <input
                    ref={simplexFileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={handleImportSimplexTxtFile}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSimplexPasteOpen(true)}
                    disabled={isLoading || isCollecting || isImportingSimplexText}
                    className="h-9 text-xs flex items-center gap-2"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste Panel Text
                  </Button>
                  <p className="text-[10px] text-muted-foreground min-w-[12rem] flex-1">
                    {!panelConnected
                      ? "Collect needs Network connection. TXT / paste imports Simplex cshow * export (M-devices)."
                      : "Collect from panel, or import the same cshow * text from a .txt file or paste."}
                  </p>
                </div>

                <Dialog open={simplexPasteOpen} onOpenChange={setSimplexPasteOpen}>
                  <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                      <DialogTitle>Paste Simplex panel export</DialogTitle>
                      <DialogDescription>
                        Paste the full output of <span className="font-mono">cshow *</span> (same format as
                        devices.txt). M-address devices are added to AssetsList; duplicates are skipped.
                      </DialogDescription>
                    </DialogHeader>
                    <Textarea
                      value={simplexPasteText}
                      onChange={(e) => setSimplexPasteText(e.target.value)}
                      placeholder="Paste cshow * text here..."
                      className="min-h-[280px] font-mono text-xs flex-1"
                    />
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSimplexPasteOpen(false)}
                        disabled={isImportingSimplexText}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleImportSimplexPaste}
                        disabled={isImportingSimplexText || !simplexPasteText.trim()}
                      >
                        {isImportingSimplexText ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          "Import assets"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Upload Form */}
                {uploadMode === "bulk" ? (
                  <div className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label htmlFor="excel-file" className="text-xs">Excel File</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="excel-file"
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".xlsx,.xls"
                            className="text-xs h-9 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Upload Excel file with asset data. Multiple sheets supported.
                        </p>
                      </div>

                      {sheetNames.length > 0 && (
                        <div>
                          <Label htmlFor="sheet-select" className="text-xs">Select Sheet/Table</Label>
                          <Select value={selectedSheet} onValueChange={handleSheetChange}>
                            <SelectTrigger id="sheet-select" className="h-9 text-xs">
                              <SelectValue placeholder="Select a sheet" />
                            </SelectTrigger>
                            <SelectContent>
                              {sheetNames.map((sheetName) => (
                                <SelectItem key={sheetName} value={sheetName} className="text-xs">
                                  {sheetName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Choose which sheet to upload from Excel file.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-end">
                      <Button
                        onClick={handleUpload}
                        disabled={isLoading || !file || !selectedSheet}
                        className="flex items-center gap-2 w-full h-9 text-xs"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {isLoading
                          ? `Uploading... (${uploadProgress.processed}/${uploadProgress.total})`
                          : "Upload to AssetsList"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <Label htmlFor="single-category" className="text-xs">Category *</Label>
                        <Select
                          value={singleCategorySelect || undefined}
                          onValueChange={(value) => {
                            setSingleCategorySelect(value)
                            handleSingleAssetFieldChange("category", value === "__custom__" ? "" : value)
                            setSingleSystemSelect("")
                            setSingleBrandSelect("")
                            handleSingleAssetFieldChange("system", "")
                            handleSingleAssetFieldChange("systems", [])
                            handleSingleAssetFieldChange("subsystems", [])
                            handleSingleAssetFieldChange("subSubsystems", [])
                            handleSingleAssetFieldChange("brand", "")
                            handleSingleAssetFieldChange("itemType", "")
                          }}
                        >
                          <SelectTrigger id="single-category" className="h-9 text-xs">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {singleCategoryOptions.map((category) => (
                              <SelectItem key={category} value={category} className="text-xs">
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="single-system" className="text-xs">System *</Label>
                        <Select
                          value={singleSystemSelect || undefined}
                          onValueChange={(value) => {
                            setSingleSystemSelect(value)
                            handleSingleAssetFieldChange("system", value)
                            handleSingleAssetFieldChange("systems", value ? [value] : [])
                            handleSingleAssetFieldChange("subsystems", [])
                            handleSingleAssetFieldChange("subSubsystems", [])
                            setSingleBrandSelect("")
                            handleSingleAssetFieldChange("brand", "")
                            handleSingleAssetFieldChange("itemType", "")
                          }}
                          disabled={!singleAssetForm.category.trim() || singleSystemOptions.length === 0}
                        >
                          <SelectTrigger id="single-system" className="h-9 text-xs">
                            <SelectValue
                              placeholder={
                                !singleAssetForm.category.trim()
                                  ? "Select category first"
                                  : singleSystemOptions.length > 0
                                    ? "Select system"
                                    : "No systems configured"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {singleSystemOptions.map((systemName) => (
                              <SelectItem key={systemName} value={systemName} className="text-xs">
                                {systemName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="single-brand" className="text-xs">Brand *</Label>
                        <Select
                          value={singleBrandSelect || undefined}
                          onValueChange={(value) => {
                            setSingleBrandSelect(value)
                            handleSingleAssetFieldChange("brand", value === "__custom__" ? "" : value)
                            handleSingleAssetFieldChange("itemType", "")
                          }}
                        >
                          <SelectTrigger id="single-brand" className="h-9 text-xs" disabled={(singleAssetForm.systems || []).length === 0}>
                            <SelectValue placeholder={(singleAssetForm.systems || []).length > 0 ? "Select brand" : "Select system first"} />
                          </SelectTrigger>
                          <SelectContent>
                            {singleBrandOptions.map((brand) => (
                              <SelectItem key={brand} value={brand} className="text-xs">
                                {brand}
                              </SelectItem>
                            ))}
                            <SelectItem value="__custom__" className="text-xs">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                        {singleBrandSelect === "__custom__" && (
                          <Input
                            value={singleAssetForm.brand}
                            onChange={(e) => handleSingleAssetFieldChange("brand", e.target.value)}
                            placeholder="Enter custom brand"
                            className="h-9 text-xs mt-2"
                          />
                        )}
                      </div>
                      <div>
                        <Label htmlFor="single-subsystem" className="text-xs">Subsystem</Label>
                        <Select
                          value={(singleAssetForm.subsystems || [])[0] || undefined}
                          onValueChange={(value) => {
                            handleSingleAssetFieldChange("subsystems", value ? [value] : [])
                            handleSingleAssetFieldChange("subSubsystems", [])
                          }}
                          disabled={getSubsystemOptionsForSingleAsset.length === 0}
                        >
                          <SelectTrigger id="single-subsystem" className="h-9 text-xs">
                            <SelectValue
                              placeholder={
                                getSubsystemOptionsForSingleAsset.length > 0
                                  ? "Select subsystem"
                                  : "No subsystems available"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {getSubsystemOptionsForSingleAsset.map((subsystemName) => (
                              <SelectItem key={subsystemName} value={subsystemName} className="text-xs">
                                {subsystemName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="single-sub-subsystem" className="text-xs">Sub-Subsystem (where available)</Label>
                        <Select
                          value={(singleAssetForm.subSubsystems || [])[0] || undefined}
                          onValueChange={(value) => handleSingleAssetFieldChange("subSubsystems", value ? [value] : [])}
                          disabled={getSubSubsystemOptionsForSingleAsset.length === 0}
                        >
                          <SelectTrigger id="single-sub-subsystem" className="h-9 text-xs">
                            <SelectValue
                              placeholder={
                                getSubSubsystemOptionsForSingleAsset.length > 0
                                  ? "Select sub-subsystem"
                                  : "No sub-subsystems configured"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {getSubSubsystemOptionsForSingleAsset.map((subSubSystemName) => (
                              <SelectItem key={subSubSystemName} value={subSubSystemName} className="text-xs">
                                {subSubSystemName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="single-item-type" className="text-xs">Item Type *</Label>
                        <Input
                          id="single-item-type"
                          value={singleAssetForm.itemType}
                          onChange={(e) => handleSingleAssetFieldChange("itemType", e.target.value)}
                          placeholder={
                            singleAssetForm.brand.trim()
                              ? singleItemTypeOptions.length > 0
                                ? `Try: ${singleItemTypeOptions.slice(0, 2).join(", ")}`
                                : "e.g. Sensor"
                              : "Select brand first"
                          }
                          disabled={!singleAssetForm.brand.trim()}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div>
                        <Label htmlFor="single-model" className="text-xs">Model</Label>
                        <Input
                          id="single-model"
                          value={singleAssetForm.model}
                          onChange={(e) => handleSingleAssetFieldChange("model", e.target.value)}
                          placeholder="e.g. XYZ-100"
                          className="h-9 text-xs"
                        />
                      </div>
                      <div>
                        <Label htmlFor="single-part-number" className="text-xs">Part Number</Label>
                        <Input
                          id="single-part-number"
                          value={singleAssetForm.partNumber}
                          onChange={(e) => handleSingleAssetFieldChange("partNumber", e.target.value)}
                          placeholder="e.g. PN-001"
                          className="h-9 text-xs"
                        />
                      </div>
                      <div>
                        <Label htmlFor="single-device-address" className="text-xs">Device Address</Label>
                        <Input
                          id="single-device-address"
                          value={singleAssetForm.deviceAddress}
                          onChange={(e) => handleSingleAssetFieldChange("deviceAddress", e.target.value)}
                          placeholder="e.g. 2:M1-1-0 or M1-1-0"
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="single-description" className="text-xs">Description</Label>
                      <Input
                        id="single-description"
                        value={singleAssetForm.description}
                        onChange={(e) => handleSingleAssetFieldChange("description", e.target.value)}
                        placeholder="Optional asset description"
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="rounded-md border p-3 space-y-3">
                      <div>
                        <p className="text-xs font-medium">Technical Properties (Dynamic)</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Auto fields based on Category + System + Item Type.
                        </p>
                      </div>
                      {!selectedTechnicalTemplate ? (
                        <p className="text-[11px] text-muted-foreground">
                          No rule matched yet. Select values like Fire Alarm, CBS, Central Monitoring, FM200, or Fire Fighting systems.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] font-medium">{selectedTechnicalTemplate.label}</p>
                          <div className="grid gap-2 md:grid-cols-2">
                            {selectedTechnicalTemplate.fields.map((fieldName) => (
                              <div key={fieldName}>
                                <Label className="text-[10px]">{fieldName}</Label>
                                <Input
                                  value={singleAssetTechnicalProps[fieldName] || ""}
                                  onChange={(e) =>
                                    handleSingleAssetTechnicalPropChange(fieldName, e.target.value)
                                  }
                                  placeholder={`Enter ${fieldName.toLowerCase()}`}
                                  className="h-9 text-xs mt-1"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={handleSingleAssetUpload}
                        disabled={
                          isLoading ||
                          !singleAssetForm.category.trim() ||
                          !singleAssetForm.brand.trim() ||
                          !(singleAssetForm.systems || []).length ||
                          !singleAssetForm.itemType.trim()
                        }
                        className="flex items-center gap-2 w-full h-9 text-xs"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {isLoading ? "Uploading..." : "Upload Single Asset"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {uploadSuccess && (
                  <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-600 dark:text-green-400 text-xs mb-1">Upload Complete</AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                      <div className="space-y-0.5 text-[11px]">
                        <p>Successfully uploaded <strong>{uploadSummary.success}</strong> new assets to AssetsList.</p>
                        {uploadSummary.skipped > 0 && (
                          <p className="text-[10px]">Skipped <strong>{uploadSummary.skipped}</strong> duplicate assets.</p>
                        )}
                        {uploadSummary.errors > 0 && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">Encountered <strong>{uploadSummary.errors}</strong> errors.</p>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* File Preview - Show when file is selected */}
                {uploadMode === "bulk" && file && selectedSheet && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      <h3 className="text-xs font-medium">File Preview: {fileName}</h3>
                      <span className="text-[10px] text-muted-foreground">(Optional: upload images)</span>
                    </div>
                    {previewData.length > 0 ? (
                      <div className="border rounded-md overflow-x-auto max-w-full max-h-[600px] overflow-y-auto">
                        <Table className="text-xs">
                          <TableHeader>
                            <TableRow className="text-[10px]">
                              {previewHeaders.map((header, index) => (
                                <TableHead key={index} className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">
                                  {header}
                                </TableHead>
                              ))}
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap sticky right-0 bg-background border-l min-w-[140px]">
                                Asset Image
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewData.map((row, rowIndex) => (
                            <TableRow key={rowIndex} className="text-[11px]">
                              {previewHeaders.map((header, cellIndex) => (
                                <TableCell key={cellIndex} className="px-2 py-1.5 max-w-[150px] truncate" title={row[header]}>
                                  {row[header] !== undefined ? String(row[header]) : ""}
                                </TableCell>
                              ))}
                              <TableCell className="px-2 py-1.5 sticky right-0 bg-background border-l">
                                <div className="flex items-center gap-1.5">
                                  {assetImages[rowIndex] ? (
                                    <div className="flex items-center gap-1 w-full">
                                      <div className="flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-400 flex-1 min-w-0">
                                        <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0" />
                                        <span className="truncate">{assetImages[rowIndex].fileName}</span>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleRemoveImage(rowIndex)}
                                        className="h-5 w-5 p-0 flex-shrink-0"
                                      >
                                        <X className="h-2.5 w-2.5" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="relative w-full">
                                      <Input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0]
                                          if (file) {
                                            handleImageUpload(rowIndex, file)
                                          }
                                        }}
                                        disabled={uploadingImages[rowIndex]}
                                        className="hidden"
                                        id={`image-upload-${rowIndex}`}
                                      />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => document.getElementById(`image-upload-${rowIndex}`).click()}
                                        disabled={uploadingImages[rowIndex]}
                                        className="h-6 text-[10px] px-2 w-full"
                                      >
                                        {uploadingImages[rowIndex] ? (
                                          <>
                                            <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
                                            <span className="truncate">Uploading...</span>
                                          </>
                                        ) : (
                                          <>
                                            <ImageIcon className="h-2.5 w-2.5 mr-0.5" />
                                            <span className="truncate">Upload</span>
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="border rounded-md p-4 text-center text-muted-foreground">
                        <Loader2 className="h-4 w-4 mx-auto mb-2 animate-spin" />
                        <p className="text-xs">Loading preview...</p>
                      </div>
                    )}
                    {previewData.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Showing all {previewData.length} rows. All data will be processed during upload. Optional: Upload images (max 5MB, JPEG/PNG/GIF/WebP).
                      </p>
                    )}
                  </div>
                )}

              </div>

              {/* Load building assets */}
              <div className="mt-4 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Load Building Assets</Label>
                  <Input
                    placeholder="e.g. WASL TOWER"
                    value={selectedBuildingName}
                    onChange={(e) => setSelectedBuildingName(e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    onClick={() => {
                      if (!selectedBuildingName) {
                        toast({ title: "Building required", description: "Enter building name", variant: "destructive" })
                        return
                      }
                      fetchExistingAssets(selectedBuildingName)
                    }}
                    size="sm"
                  >
                    Load Building Assets
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedBuildingName("")
                      fetchExistingAssets() // reload global list
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Already Uploaded Assets Table */}
          <Card className="shadow-md">
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Already Uploaded Assets</span>
                <div className="flex items-center gap-2">
                  {Object.keys(pendingImageUploads).length > 0 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleSaveImages}
                      disabled={isSavingImages}
                      className="h-7 text-xs"
                    >
                      {isSavingImages ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          Save ({Object.keys(pendingImageUploads).length})
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchExistingAssets}
                    disabled={isLoadingExistingAssets}
                    className="h-7 text-xs"
                  >
                    {isLoadingExistingAssets ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3">
              {isLoadingExistingAssets ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading assets...</span>
                </div>
              ) : existingAssets.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium">No assets uploaded yet</p>
                  <p className="text-xs mt-1">Upload assets using the form above</p>
                </div>
              ) : (
                <>
                  {/* Filters and Search */}
                  <div className="mb-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      {/* Search */}
                      <div className="md:col-span-1">
                        <Label htmlFor="asset-search" className="text-xs">Search</Label>
                        <div className="relative">
                          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            id="asset-search"
                            placeholder="Search assets..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8 h-8 text-xs"
                          />
                        </div>
                      </div>

                      {/* Brand Filter */}
                      <div>
                        <Label htmlFor="brand-filter" className="text-xs">Brand</Label>
                        <Select value={filterBrand} onValueChange={setFilterBrand}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="All Brands" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Brands</SelectItem>
                            {uniqueBrandOptions.map((brand) => (
                              <SelectItem key={brand} value={brand}>
                                {brand}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Category Filter */}
                      <div>
                        <Label htmlFor="category-filter" className="text-xs">Category</Label>
                        <Select value={filterCategory} onValueChange={setFilterCategory}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="All Categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {uniqueCategoryOptions.map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* System Filter */}
                      <div>
                        <Label htmlFor="system-filter" className="text-xs">System</Label>
                        <Select value={filterSystem} onValueChange={setFilterSystem}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="All Systems" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Systems</SelectItem>
                            {uniqueSystemOptions.map((system) => (
                              <SelectItem key={system} value={system}>
                                {system}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Results count and clear filters */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Showing{" "}
                        {filteredAssets.length === 0
                          ? 0
                          : `${assetsPage * ASSETS_PAGE_SIZE + 1}-${Math.min(
                              (assetsPage + 1) * ASSETS_PAGE_SIZE,
                              filteredAssets.length,
                            )}`}{" "}
                        of {filteredAssets.length} filtered
                        {existingAssets.length !== filteredAssets.length
                          ? ` (${existingAssets.length} total)`
                          : ""}{" "}
                        assets
                      </span>
                      {(searchTerm || filterBrand !== "all" || filterCategory !== "all" || filterSystem !== "all") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSearchTerm("")
                            setFilterBrand("all")
                            setFilterCategory("all")
                            setFilterSystem("all")
                          }}
                          className="h-6 text-xs"
                        >
                          Clear Filters
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedCount > 0 && (
                    <div className="mb-3 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                      <span className="text-xs font-medium">
                        {selectedCount} asset{selectedCount === 1 ? "" : "s"} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isBulkDeleting}
                          onClick={() => setSelectedAssetKeys([])}
                        >
                          Clear selection
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isBulkDeleting}
                          onClick={handleBulkDeleteSelected}
                        >
                          {isBulkDeleting ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Deleting{bulkDeleteProgress.total > 0
                                ? ` ${bulkDeleteProgress.processed}/${bulkDeleteProgress.total}`
                                : "..."}
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-3 w-3 mr-1" />
                              Delete selected
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Scrollable Table */}
                  <div className="border rounded-md overflow-x-auto max-h-[600px] overflow-y-auto">
                    <Table className="text-xs">
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow className="text-[10px]">
                          <TableHead className="w-10 px-2 py-1.5">
                            <Checkbox
                              checked={allFilteredSelected}
                              onCheckedChange={(checked) => toggleSelectAllFiltered(!!checked)}
                              aria-label="Select all visible assets"
                              disabled={filteredAssets.length === 0 || isBulkDeleting}
                            />
                          </TableHead>
                          {isBuildingAsset ? (
                            <>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Building Asset ID</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Asset Name</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Asset Category</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Device Location</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Device Address</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Model</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Created At</TableHead>
                              <TableHead className="px-2 py-1.5 text-right w-10">
                                <span className="sr-only">Actions</span>
                              </TableHead>
                            </>
                          ) : (
                            <>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Image</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Brand</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">System</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Category</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Device Address</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Part Number</TableHead>
                              <TableHead className="px-2 py-1.5 text-[10px] font-medium whitespace-nowrap">Description</TableHead>
                              <TableHead className="px-2 py-1.5 text-right w-10">
                                <span className="sr-only">Actions</span>
                              </TableHead>
                            </>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAssets.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={isBuildingAsset ? 9 : 9} className="text-center py-8 text-muted-foreground">
                              No assets found matching your filters
                            </TableCell>
                          </TableRow>
                        ) : (
                          pagedAssets.map((asset) => {
                            const rowKey = getAssetRowKey(asset)
                            const isSelected = selectedAssetKeySet.has(rowKey)
                            return (
                            <TableRow
                              key={rowKey}
                              className={`text-[11px] ${isSelected ? "bg-muted/50" : ""} cursor-pointer`}
                              onClick={() => toggleAssetSelection(asset, !isSelected)}
                            >
                              <TableCell className="px-2 py-1.5">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => toggleAssetSelection(asset, !!checked)}
                                  disabled={isBulkDeleting}
                                  aria-label={`Select ${asset.assetId || asset.buildingAssetId || asset.id}`}
                                />
                              </TableCell>
                              {isBuildingAsset ? (
                                <>
                                  <TableCell className="px-2 py-1.5 max-w-[150px] truncate" title={asset.buildingAssetId || asset.id}>
                                    {asset.buildingAssetId || asset.id}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[160px] truncate" title={asset.assetName || ""}>
                                    {asset.assetName || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[120px] truncate" title={asset.assetCategory || asset.category || ""}>
                                    {asset.assetCategory || asset.category || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[160px] truncate" title={asset.deviceLocation || ""}>
                                    {asset.deviceLocation || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[140px] truncate" title={resolveAssetDeviceAddress(asset) || ""}>
                                    {resolveAssetDeviceAddress(asset) || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[120px] truncate" title={asset.partModelNumber || asset.partNumber || ""}>
                                    {asset.partModelNumber || asset.partNumber || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 whitespace-nowrap">
                                    {asset.createdAt ? new Date(asset.createdAt).toLocaleString() : "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenu modal={false}>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8"
                                          disabled={deletingAssetId === asset.id || isBulkDeleting}
                                        >
                                          {Object.values(uploadingDocTypes[asset.id] || {}).some(Boolean) ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <MoreHorizontal className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "dataSheet")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Data Sheet
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.dataSheetUrl}
                                          onClick={() => openDocPreview(asset.dataSheetUrl, DOC_TYPE_DEFS.dataSheet.label)}
                                        >
                                          View Data Sheet
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "brochure")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Brochure
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.brochureUrl}
                                          onClick={() => openDocPreview(asset.brochureUrl, DOC_TYPE_DEFS.brochure.label)}
                                        >
                                          View Brochure
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "installationGuide")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Installation Guide
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.installationGuideUrl}
                                          onClick={() =>
                                            openDocPreview(asset.installationGuideUrl, DOC_TYPE_DEFS.installationGuide.label)
                                          }
                                        >
                                          View Installation Guide
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "operationGuide")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Operation Guide
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.operationGuideUrl}
                                          onClick={() =>
                                            openDocPreview(asset.operationGuideUrl, DOC_TYPE_DEFS.operationGuide.label)
                                          }
                                        >
                                          View Operation Guide
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "brochurePdf")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Brochure PDF
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.brochurePdfUrl}
                                          onClick={() => openDocPreview(asset.brochurePdfUrl, DOC_TYPE_DEFS.brochurePdf.label)}
                                        >
                                          View Brochure PDF
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onClick={() => openEditAssetDialog(asset)}
                                        >
                                          Edit Item
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          className="text-destructive"
                                          disabled={deletingAssetId === asset.id}
                                          onClick={() => handleDeleteAsset(asset)}
                                        >
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          Delete Asset
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                    <AssetImageCell
                                      asset={asset}
                                      onImageClick={handleExistingAssetImageSelect}
                                      pendingImageUrl={pendingImageUploads[asset.id]?.url}
                                      isUploading={pendingImageUploads[asset.id]?.uploading}
                                    />
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[120px] truncate" title={asset.brand || ""}>
                                    {asset.brand || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[120px] truncate" title={asset.system || ""}>
                                    {asset.system || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[120px] truncate" title={asset.category || ""}>
                                    {asset.category || "-"}
                                  </TableCell>
                                  <TableCell
                                    className="px-2 py-1.5 max-w-[140px] truncate font-mono"
                                    title={resolveAssetDeviceAddress(asset) || asset.deviceAddress || ""}
                                  >
                                    {resolveAssetDeviceAddress(asset) || asset.deviceAddress || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[140px] truncate" title={asset.partNumber || ""}>
                                    {asset.partNumber || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 max-w-[200px] truncate" title={asset.description || ""}>
                                    {asset.description || "-"}
                                  </TableCell>
                                  <TableCell className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenu modal={false}>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8"
                                          disabled={deletingAssetId === asset.id || isBulkDeleting}
                                        >
                                          {Object.values(uploadingDocTypes[asset.id] || {}).some(Boolean) ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <MoreHorizontal className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "dataSheet")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Data Sheet
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.dataSheetUrl}
                                          onClick={() => openDocPreview(asset.dataSheetUrl, DOC_TYPE_DEFS.dataSheet.label)}
                                        >
                                          View Data Sheet
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "brochure")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Brochure
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.brochureUrl}
                                          onClick={() => openDocPreview(asset.brochureUrl, DOC_TYPE_DEFS.brochure.label)}
                                        >
                                          View Brochure
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "installationGuide")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Installation Guide
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.installationGuideUrl}
                                          onClick={() =>
                                            openDocPreview(asset.installationGuideUrl, DOC_TYPE_DEFS.installationGuide.label)
                                          }
                                        >
                                          View Installation Guide
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "operationGuide")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Operation Guide
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.operationGuideUrl}
                                          onClick={() =>
                                            openDocPreview(asset.operationGuideUrl, DOC_TYPE_DEFS.operationGuide.label)
                                          }
                                        >
                                          View Operation Guide
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            openDocUploadModal(asset, "brochurePdf")
                                          }}
                                        >
                                          <Upload className="mr-2 h-4 w-4" />
                                          Upload Brochure PDF
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!asset.brochurePdfUrl}
                                          onClick={() => openDocPreview(asset.brochurePdfUrl, DOC_TYPE_DEFS.brochurePdf.label)}
                                        >
                                          View Brochure PDF
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          onClick={() => openEditAssetDialog(asset)}
                                        >
                                          Edit Item
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          className="text-destructive"
                                          disabled={deletingAssetId === asset.id}
                                          onClick={() => handleDeleteAsset(asset)}
                                        >
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          Delete Asset
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          )
                        })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {filteredAssets.length > ASSETS_PAGE_SIZE ? (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        Page {assetsPage + 1} of {totalAssetPages}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={assetsPage <= 0}
                          onClick={() => setAssetsPage((page) => Math.max(0, page - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={assetsPage >= totalAssetPages - 1}
                          onClick={() =>
                            setAssetsPage((page) => Math.min(totalAssetPages - 1, page + 1))
                          }
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <Dialog
                    open={editAssetDialog.open}
                    onOpenChange={(open) => {
                      if (!open) {
                        setEditAssetDialog({ open: false, asset: null, formValues: {}, fieldTypes: {} })
                      }
                    }}
                  >
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Edit Item</DialogTitle>
                        <DialogDescription>
                          Update any field value for this row. For object/array fields, provide valid JSON.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
                        {Object.keys(editAssetDialog.formValues).length === 0 ? (
                          <p className="text-sm text-muted-foreground">No editable fields available.</p>
                        ) : (
                          Object.entries(editAssetDialog.formValues).map(([key, value]) => {
                            const fieldType = editAssetDialog.fieldTypes[key] || "string"
                            const isJsonType = fieldType === "object" || fieldType === "array"
                            return (
                              <div key={key} className="space-y-1">
                                <Label className="text-xs">
                                  {key} <span className="text-muted-foreground">({fieldType})</span>
                                </Label>
                                {isJsonType ? (
                                  <textarea
                                    value={value}
                                    onChange={(e) => handleEditAssetFieldChange(key, e.target.value)}
                                    className="w-full min-h-24 rounded-md border bg-background px-3 py-2 text-xs"
                                  />
                                ) : (
                                  <Input
                                    value={value}
                                    onChange={(e) => handleEditAssetFieldChange(key, e.target.value)}
                                    className="h-9 text-xs"
                                  />
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setEditAssetDialog({ open: false, asset: null, formValues: {}, fieldTypes: {} })
                          }
                        >
                          Cancel
                        </Button>
                        <Button type="button" onClick={handleSaveEditedAsset}>
                          Save Changes
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* Drag-and-drop upload modal (opened from 3-dot → Upload …) */}
                  <Dialog
                    open={!!docUploadModal}
                    onOpenChange={(open) => {
                      if (!open) {
                        setDocUploadModal(null)
                        setDocDragActive(false)
                        if (docModalInputRef.current) docModalInputRef.current.value = ""
                      }
                    }}
                  >
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>
                          {docUploadModal
                            ? `Upload ${DOC_TYPE_DEFS[docUploadModal.docTypeKey]?.label ?? "document"}`
                            : "Upload document"}
                        </DialogTitle>
                        <DialogDescription>
                          Drag and drop a PDF here, or click the area to browse. Maximum size 20MB.
                        </DialogDescription>
                      </DialogHeader>
                      <input
                        ref={docModalInputRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void handleModalDocFile(f)
                        }}
                      />
                      <div className="relative">
                        <div
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              if (!docModalUploading) docModalInputRef.current?.click()
                            }
                          }}
                          className={cn(
                            "relative flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors outline-none",
                            docModalUploading
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer hover:border-muted-foreground/50",
                            docDragActive && !docModalUploading
                              ? "border-primary bg-primary/5"
                              : "border-muted-foreground/25 bg-muted/30"
                          )}
                          onClick={() => {
                            if (!docModalUploading) docModalInputRef.current?.click()
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (!docModalUploading) setDocDragActive(true)
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            e.dataTransfer.dropEffect = "copy"
                            if (!docModalUploading) setDocDragActive(true)
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (e.currentTarget.contains(e.relatedTarget)) return
                            setDocDragActive(false)
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setDocDragActive(false)
                            if (docModalUploading) return
                            const f = e.dataTransfer.files?.[0]
                            if (f) void handleModalDocFile(f)
                          }}
                        >
                          {docModalUploading ? (
                            <>
                              <Loader2 className="mb-3 h-10 w-10 animate-spin text-muted-foreground" />
                              <p className="text-sm font-medium">Uploading…</p>
                            </>
                          ) : (
                            <>
                              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
                              <p className="text-sm font-medium">Drop PDF file here</p>
                              <p className="text-xs text-muted-foreground mt-1">or click to choose a file</p>
                            </>
                          )}
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* PDF preview */}
                  <Dialog
                    open={docPreviewDialog.open}
                    onOpenChange={(nextOpen) => {
                      if (!nextOpen) setDocPreviewDialog({ open: false, url: "", title: "" })
                      else setDocPreviewDialog((prev) => ({ ...prev, open: nextOpen }))
                    }}
                  >
                    <DialogContent className="max-w-4xl">
                      <DialogHeader>
                        <DialogTitle>{docPreviewDialog.title || "Document Preview"}</DialogTitle>
                      </DialogHeader>
                      <div className="border rounded-md overflow-hidden h-[70vh]">
                        {docPreviewDialog.url ? (
                          <iframe
                            src={`${docPreviewDialog.url}#toolbar=0`}
                            className="w-full h-full"
                            title={docPreviewDialog.title || "PDF Preview"}
                          />
                        ) : null}
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              )}
            </CardContent>
          </Card>
        </div>
  </DashboardHeader>  )
}
