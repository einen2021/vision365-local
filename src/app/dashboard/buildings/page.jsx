"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import secureLocalStorage from "react-secure-storage";
import { useToast } from "@/hooks/use-toast";
import { isConsultantLikeRole, normalizeRoleKey } from "@/lib/roleAccess";
import { getStoredSessionUser, parseStoredUser } from "@/lib/sessionUser";
import { AppSidebar } from "@/components/app-sidebar";
import { ModeToggle } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, storage } from "@/config/firebase";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import FirestoreService from "@/services/firestoreService";
import { getBrandOptionsFromRegistry, loadBrandRegistry } from "@/utils/brandRegistryService";
import { getUserCommunities } from "@/utils/communityService";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { useAppData } from "@/hooks/useAppData";
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"
import { BuildingDetailsEditDialog } from "@/components/buildings/BuildingDetailsEditDialog";

const createContactDetails = () => ({
  name: "",
  designation: "",
  email: "",
  phoneNumbers: [""],
});

const JOB_TYPES = ["Project", "Services", "Vision365 Plan"];

const PROJECT_JOBS = [
  "Material Supply Only",
  "Installation Only",
  "Supply & Installation",
  "Fit-out",
  "DCD Certification",
];

const SERVICE_JOBS = [
  "Material Supply Only",
  "Site Survey",
  "AMC",
  "Service",
  "Callout",
  "Rectification",
  "One-time maintenance",
  "DCD Certification",
];

const VISION365_PLAN_JOBS = [
  "Basic (only notification services)",
  "Single Building (1 panel)",
  "Single Property ( Network panel)",
  "Community (min 5 Buildings)",
];

function ContactDetailsBlock({
  title,
  contact,
  setContact,
  updateContactDetail,
  updateContactPhone,
  addContactPhone,
  removeContactPhone,
  wrapperClassName = "mt-4",
}) {
  return (
    <div className={`${wrapperClassName} rounded-md border p-4`}>
      <h3 className="font-medium">{title}</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input
          placeholder="Name"
          value={contact.name}
          onChange={(e) => updateContactDetail(setContact, contact, "name", e.target.value)}
        />
        <Input
          placeholder="Designation"
          value={contact.designation}
          onChange={(e) => updateContactDetail(setContact, contact, "designation", e.target.value)}
        />
        <Input
          placeholder="Email"
          value={contact.email}
          onChange={(e) => updateContactDetail(setContact, contact, "email", e.target.value)}
        />
      </div>
      {contact.phoneNumbers.map((phone, idx) => (
        <div key={`${title}-phone-${idx}`} className="mt-3 flex gap-2">
          <Input
            placeholder={`Phone ${idx + 1}`}
            value={phone}
            onChange={(e) => updateContactPhone(setContact, contact, idx, e.target.value)}
          />
          <Button type="button" variant="outline" onClick={() => removeContactPhone(setContact, contact, idx)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="mt-3" onClick={() => addContactPhone(setContact, contact)}>
        Add Phone
      </Button>
    </div>
  );
}

/** Company registry type label must match Manage Company (`companyType`). */
function ProjectContractorPair({
  roleTitle,
  companyType,
  companySelectId,
  fmCompanies,
  companyId,
  setCompanyId,
  companyContact,
  setCompanyContact,
  applyCompanyFromDoc,
  updateContactDetail,
  updateContactPhone,
  addContactPhone,
  removeContactPhone,
  wrapperClassName = "mt-4",
}) {
  const filteredCompanies = fmCompanies.filter(
    (c) =>
      String(c?.companyType || "").trim().toLowerCase() ===
      String(companyType || "").trim().toLowerCase(),
  );

  return (
    <>
      <div className={wrapperClassName}>
        <div>
          <Label htmlFor={companySelectId}>{roleTitle} — company</Label>
          <select
            id={companySelectId}
            value={companyId}
            onChange={(e) => {
              const selectedId = e.target.value;
              setCompanyId(selectedId);
              const doc = fmCompanies.find((item) => item.id === selectedId);
              if (doc) applyCompanyFromDoc(doc);
              else {
                setCompanyContact(createContactDetails());
              }
            }}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select company</option>
            {filteredCompanies.map((company) => (
              <option key={company.id} value={company.id}>
                {company?.companyName || "Unnamed company"}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ContactDetailsBlock
        title={roleTitle}
        contact={companyContact}
        setContact={setCompanyContact}
        updateContactDetail={updateContactDetail}
        updateContactPhone={updateContactPhone}
        addContactPhone={addContactPhone}
        removeContactPhone={removeContactPhone}
        wrapperClassName="mt-3"
      />
    </>
  );
}

/** Same codes as Operation Dashboard PPM and Handover / mobile snag reports */
const SYSTEM_OPTIONS = ["FA", "FF", "CBS", "CMS", "PAVE", "SCL"];

const SYSTEM_LABELS = {
  FA: "Fire Alarm",
  FF: "Fire Fighting",
  CBS: "Central Battery System",
  CMS: "Central Monitoring System",
  PAVE: "Public Address / Voice Evacuation",
  SCL: "Smoke Control",
};

const formatSystemOption = (code) => {
  const label = SYSTEM_LABELS[code];
  return label ? `${code} — ${label}` : code;
};

/** system → subsystem → leaf categories for System Brand Mapping */
const SYSTEM_BRAND_STRUCTURE = {
  FA: {
    "Control Panels": ["Main FACP", "Repeater Panels", "Network Nodes"],
    "Initiating Devices": ["Smoke Detectors", "Heat Detectors", "Manual Call Points", "Beam Detectors"],
    "Notification Devices": ["Sounders", "Visual Indicators", "Speakers"],
  },
  FF: {
    Pumps: ["Electric Pump", "Diesel Pump", "Jockey Pump"],
    Valves: ["Alarm Valve", "Deluge Valve", "Butterfly Valves"],
    Sprinklers: ["Pendant", "Upright", "Sidewall", "ESFR"],
    Hydrants: ["Landing Valves", "Fire Hose Cabinets"],
    Extinguisher: [
      "Dry Chemical Powder (DCP) (A, B & C)",
      "Carbon Dioxide (Electrical and liquid fires (Class B))",
    ],
  },
  CBS: {
    "Central Units": ["Inverters", "Battery Banks", "Chargers"],
    Distribution: ["Sub Circuits", "Monitoring Modules"],
    Luminaires: ["Maintained", "Non-maintained", "EXIT Signs"],
  },
  CMS: {
    Workstations: ["Operator PC", "Redundant Server"],
    Peripherals: ["Printers", "UPS"],
    Connectivity: ["Fiber", "Copper", "Radio"],
  },
  PAVE: {
    Amplification: ["Power Amplifiers", "Line Monitoring"],
    Speakers: ["Ceiling", "Wall", "Horn"],
    Control: ["Microphones", "Paging Zones", "BMS Interface"],
  },
  SCL: {
    Pressurization: ["Supply Fans", "Relief Dampers", "Pressure Sensors"],
    "Smoke Vent": ["Roof Vents", "Curtain Wall Vents", "Release Panels"],
    Dampers: ["Fire Dampers", "Smoke Dampers", "Combination"],
  },
};

const createSystemBrandEntry = () => ({
  category: "",
  system: "",
  subsystem: "",
  subsubsystem: "",
  brandName: "",
  brandImageFile: null,
  brandImagePreview: "",
});

const ENQUIRY_ID_PREFIX = "IN-";
const ENQUIRY_SEQUENCE_START = 10001;
const FM_COMPANIES_COLLECTION = "FmCompanies";

const parseEnquirySequence = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/^IN-(\d+)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
};

const formatEnquiryId = (seq) => {
  if (!Number.isFinite(seq) || seq < 0) return `${ENQUIRY_ID_PREFIX}${ENQUIRY_SEQUENCE_START}`;
  if (seq < 100000) return `${ENQUIRY_ID_PREFIX}${String(seq).padStart(5, "0")}`;
  return `${ENQUIRY_ID_PREFIX}${seq}`;
};

const findSalesCommunity = (communities) =>
  (communities || []).find((c) =>
    String(c?.communityName || c?.name || "").toLowerCase().includes("sales"),
  );

const extractCommunityBuildingBaseNames = (community) => {
  if (!community || !Array.isArray(community.buildings)) return [];
  return community.buildings
    .map((item) =>
      typeof item === "string"
        ? item
        : item?.buildingName || item?.name || item?.id || "",
    )
    .map(normalizeBuildingName)
    .filter(Boolean);
};

const resolveSalesCommunity = async (email, role) => {
  try {
    const roleKey = normalizeRoleKey(role || "user");
    let data = await getUserCommunities(email, role || "user");

    if (!data?.status || !(data.communities || []).length) {
      if (roleKey !== "consultant") {
        data = await getUserCommunities(email, "admin");
      }
    }
    
    if (!data?.status) return null;

    // Find the sales community
    let sales = findSalesCommunity(data.communities || []);
    if (!sales) {
      // If still not found, try explicitly with admin
      const adminData = await getUserCommunities(email, "admin");
      if (adminData?.status) {
        sales = findSalesCommunity(adminData.communities || []);
      }
    }
    return sales || null;
  } catch (error) {
    console.error("Error resolving sales community:", error);
    return null;
  }
};

const computeNextEnquirySequence = async (buildingBaseNames) => {
  const unique = [...new Set(buildingBaseNames.map(normalizeBuildingName).filter(Boolean))];
  let maxSeq = ENQUIRY_SEQUENCE_START - 1;
  await Promise.all(
    unique.map(async (base) => {
      try {
        const detailsRef = doc(db, `${base}BuildingDB`, "buildingDetails");
        const snap = await getDoc(detailsRef);
        if (!snap.exists()) return;
        const d = snap.data() || {};
        const raw = d.enquiryId ?? d.enquiryID ?? d.enquiry_id;
        const parsed = parseEnquirySequence(typeof raw === "string" ? raw : String(raw || ""));
        if (parsed != null && parsed > maxSeq) maxSeq = parsed;
      } catch {
        /* ignore missing / permission errors per building */
      }
    }),
  );
  return maxSeq + 1;
};

const fetchSalesBuildingBaseNames = async (email, role) => {
  const sales = await resolveSalesCommunity(email, role);
  if (!sales) return [];
  return extractCommunityBuildingBaseNames(sales);
};

export default function ManageBuildings() {
  const [buildingName, setBuildingName] = useState("");
  const [floorDetails, setFloorDetails] = useState("");
  const [location, setLocation] = useState("");
  const [plotNumber, setPlotNumber] = useState("");
  const [mapData, setMapData] = useState("");
  const [jobType, setJobType] = useState("Services");
  const [job, setJob] = useState("");
  const [selectedFitOutCompanyId, setSelectedFitOutCompanyId] = useState("");
  const [fitOutCompanyContactDetails, setFitOutCompanyContactDetails] = useState(createContactDetails());
  const [selectedMainContractorCompanyId, setSelectedMainContractorCompanyId] = useState("");
  const [mainContractorCompanyContactDetails, setMainContractorCompanyContactDetails] =
    useState(createContactDetails());
  const [selectedMepContractorCompanyId, setSelectedMepContractorCompanyId] = useState("");
  const [mepContractorCompanyContactDetails, setMepContractorCompanyContactDetails] =
    useState(createContactDetails());
  const [selectedConsultantCompanyId, setSelectedConsultantCompanyId] = useState("");
  const [consultantCompanyContactDetails, setConsultantCompanyContactDetails] = useState(createContactDetails());
  const [fmCompany, setFmCompany] = useState("");
  const [selectedFmCompanyId, setSelectedFmCompanyId] = useState("");
  const [fmCompanies, setFmCompanies] = useState([]);
  const [flsOperator, setFlsOperator] = useState("");
  const [selectedFlsOperatorIdx, setSelectedFlsOperatorIdx] = useState("");
  const [fireAlarmBrand, setFireAlarmBrand] = useState("");
  const [fireFightingBrand, setFireFightingBrand] = useState("");
  const [firstPpmDate, setFirstPpmDate] = useState("");
  const [fmCompanyContactDetails, setFmCompanyContactDetails] = useState(createContactDetails());
  const [operatorDetails, setOperatorDetails] = useState(createContactDetails());
  const [systemBrandEntries, setSystemBrandEntries] = useState([createSystemBrandEntry()]);
  const [brandRegistry, setBrandRegistry] = useState([]);
  const [buildingImageFile, setBuildingImageFile] = useState(null);
  const [buildingImagePreview, setBuildingImagePreview] = useState("");
  const { buildingNames, communities: scopedCommunities, isReady, refetchCommunities, isLoadingCommunities } = useAppData();
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [nextEnquiryId, setNextEnquiryId] = useState("");
  const [loadingEnquiryId, setLoadingEnquiryId] = useState(false);
  const [editBuildingDialogOpen, setEditBuildingDialogOpen] = useState(false);
  const [editingBuildingName, setEditingBuildingName] = useState("");
  const imageInputRef = useRef(null);
  const { toast } = useToast();
  const router = useRouter();
  const isConsultant = isConsultantLikeRole(currentUserRole);

  const refreshNextEnquiryId = useCallback(async () => {
    const user = getStoredSessionUser();
    if (!user?.email || !isConsultantLikeRole(user?.role)) {
      setNextEnquiryId("");
      return;
    }
    setLoadingEnquiryId(true);
    try {
      let names = [];
      if (isReady && (buildingNames?.length || scopedCommunities?.length)) {
        names = buildingNames?.length
          ? buildingNames
          : extractCommunityBuildingBaseNames(
              (scopedCommunities || []).find((c) =>
                String(c?.communityName || c?.name || "")
                  .toLowerCase()
                  .includes("sales"),
              ) || scopedCommunities[0],
            );
      } else {
        names = await fetchSalesBuildingBaseNames(user.email, user.role || "user");
      }
      const seq = await computeNextEnquirySequence(names);
      setNextEnquiryId(formatEnquiryId(seq));
    } catch (e) {
      console.error("Enquiry ID: failed to resolve next sequence", e);
      setNextEnquiryId(formatEnquiryId(ENQUIRY_SEQUENCE_START));
    } finally {
      setLoadingEnquiryId(false);
    }
  }, [isReady, buildingNames, scopedCommunities]);

  useEffect(() => {
    return () => {
      if (buildingImagePreview) URL.revokeObjectURL(buildingImagePreview);
      systemBrandEntries.forEach((entry) => {
        if (entry.brandImagePreview) URL.revokeObjectURL(entry.brandImagePreview);
      });
    };
  }, [buildingImagePreview, systemBrandEntries]);

  useEffect(() => {
    const user = getStoredSessionUser();
    if (!user) {
      router.push("/");
    } else {
      setLoggedIn(true);
      setCurrentUserRole(user.role || "");
      refreshNextEnquiryId();
    }
  }, [router, refreshNextEnquiryId]);

  useEffect(() => {
    if (!isReady) return;
    setBuildings((prev) => {
      const next = buildingNames || [];
      if (
        prev.length === next.length &&
        prev.every((name, index) => name === next[index])
      ) {
        return prev;
      }
      return next;
    });
  }, [isReady, buildingNames]);

  useEffect(() => {
    if (!loggedIn || !isReady) return;
    refreshNextEnquiryId();
  }, [loggedIn, isReady, refreshNextEnquiryId]);

  const fetchingBuildings = isLoadingCommunities;

  const fetchFmCompanies = useCallback(async () => {
    try {
      const q = query(collection(db, FM_COMPANIES_COLLECTION), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setFmCompanies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Failed to fetch FM companies (ordered):", err);
      try {
        const snap = await getDocs(collection(db, FM_COMPANIES_COLLECTION));
        setFmCompanies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (fallbackErr) {
        console.error("Failed to fetch FM companies:", fallbackErr);
        setFmCompanies([]);
      }
    }
  }, []);

  const fetchBrandRegistry = useCallback(async () => {
    try {
      const rows = await loadBrandRegistry(db, getDocs, collection);
      setBrandRegistry(rows);
    } catch (err) {
      console.error("Failed to fetch BrandRegistry:", err);
      setBrandRegistry([]);
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    fetchFmCompanies();
    fetchBrandRegistry();
  }, [loggedIn, fetchFmCompanies, fetchBrandRegistry]);

  const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

  const getTimestampAtNoon = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(12, 0, 0, 0);
    return Timestamp.fromDate(date);
  };

  const sanitizeContactDetails = (contact) => ({
    name: normalizeText(contact.name),
    designation: normalizeText(contact.designation),
    email: normalizeText(contact.email),
    phoneNumbers: (contact.phoneNumbers || []).map(normalizeText).filter(Boolean),
  });

  const extractOperatorDetail = (operator) => {
    const name = normalizeText(operator?.name);
    const designation = normalizeText(operator?.designation);
    const email = normalizeText(operator?.email || operator?.emailId);
    const phone = normalizeText(
      operator?.contact || operator?.contactNumber || operator?.phone || operator?.mobile,
    );
    return { name, designation, email, phone };
  };

  const applyProjectCompanyToForm = (companyDoc, setCompanyContact) => {
    if (!companyDoc) return;
    const companyName = normalizeText(companyDoc?.companyName);
    const companyContactNum = normalizeText(companyDoc?.contactNumber);
    const companyEmail = normalizeText(companyDoc?.emailId);
    const companyAddress = normalizeText(companyDoc?.companyAddress);

    setCompanyContact({
      name: companyName || "",
      designation: companyAddress || "",
      email: companyEmail || "",
      phoneNumbers: companyContactNum ? [companyContactNum] : [""],
    });
  };

  const applyFmCompanyToForm = useCallback(
    (companyDoc) => {
      if (!companyDoc) return;

      const companyName = normalizeText(companyDoc?.companyName);
      const companyContact = normalizeText(companyDoc?.contactNumber);
      const companyEmail = normalizeText(companyDoc?.emailId);
      const companyAddress = normalizeText(companyDoc?.companyAddress);

      const operatorTeam = Array.isArray(companyDoc?.teams?.operationsTeam)
        ? companyDoc.teams.operationsTeam
        : [];
      const firstOperator = operatorTeam[0] || null;
      const { name: operatorName, designation: operatorDesignation, email: operatorEmail, phone: operatorContact } =
        extractOperatorDetail(firstOperator);

      if (companyName) setFmCompany(companyName);
      setFlsOperator(operatorName || "");
      setSelectedFlsOperatorIdx(firstOperator ? "0" : "");

      setFmCompanyContactDetails((prev) => ({
        name: companyName || normalizeText(prev.name),
        designation: companyAddress || normalizeText(prev.designation),
        email: companyEmail || normalizeText(prev.email),
        phoneNumbers: companyContact ? [companyContact] : [""],
      }));

      setOperatorDetails((prev) => ({
        name: operatorName || normalizeText(prev.name),
        designation: operatorDesignation || normalizeText(prev.designation),
        email: operatorEmail || normalizeText(prev.email),
        phoneNumbers: operatorContact ? [operatorContact] : [""],
      }));
    },
    [setFmCompany, setFlsOperator, setSelectedFlsOperatorIdx, setFmCompanyContactDetails, setOperatorDetails],
  );

  const updateContactDetail = (setter, contact, key, value) => {
    setter({ ...contact, [key]: value });
  };

  const updateContactPhone = (setter, contact, idx, value) => {
    const nextPhones = [...contact.phoneNumbers];
    nextPhones[idx] = value;
    setter({ ...contact, phoneNumbers: nextPhones });
  };

  const addContactPhone = (setter, contact) => {
    setter({ ...contact, phoneNumbers: [...contact.phoneNumbers, ""] });
  };

  const removeContactPhone = (setter, contact, idx) => {
    if (contact.phoneNumbers.length <= 1) return;
    setter({
      ...contact,
      phoneNumbers: contact.phoneNumbers.filter((_, index) => index !== idx),
    });
  };

  const handleSystemBrandChange = (index, key, value) => {
    setSystemBrandEntries((prev) => {
      return prev.map((entry, idx) => {
        if (idx !== index) return entry;
        if (key === "system") {
          return {
            ...entry,
            system: value,
            subsystem: "",
            subsubsystem: "",
          };
        }
        if (key === "category") {
          return {
            ...entry,
            category: value,
            system: "",
            subsystem: "",
            subsubsystem: "",
          };
        }
        if (key === "subsystem") {
          return {
            ...entry,
            subsystem: value,
            subsubsystem: "",
          };
        }
        return { ...entry, [key]: value };
      });
    });
  };

  const getSystems = () => SYSTEM_OPTIONS.filter((code) => SYSTEM_BRAND_STRUCTURE[code]);

  const getSubsystems = (system) =>
    system && SYSTEM_BRAND_STRUCTURE[system]
      ? Object.keys(SYSTEM_BRAND_STRUCTURE[system])
      : [];

  const getSubsubsystems = (system, subsystem) =>
    system && subsystem && SYSTEM_BRAND_STRUCTURE[system]?.[subsystem]
      ? SYSTEM_BRAND_STRUCTURE[system][subsystem]
      : [];

  const brandCategoryOptions = useCallback(() => {
    const out = new Set();
    brandRegistry.forEach((row) => {
      (row?.categories || []).forEach((c) => {
        if (normalizeText(c)) out.add(String(c).trim());
      });
      if (normalizeText(row?.category)) out.add(String(row.category).trim());
    });
    return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [brandRegistry]);

  const getBrandOptionsForSystemPath = (category, system, subsystem, subsubsystem) => {
    const fullScoped = getBrandOptionsFromRegistry(brandRegistry, {
      category,
      system,
      subsystem,
      subsubsystem,
    });
    if (fullScoped.length) return fullScoped;
    if (normalizeText(category)) {
      return getBrandOptionsFromRegistry(brandRegistry, { category });
    }
    return getBrandOptionsFromRegistry(brandRegistry, {});
  };

  const handleSystemBrandImage = (index, file) => {
    if (!file || !file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please select a valid image file", variant: "destructive" });
      return;
    }
    setSystemBrandEntries((prev) =>
      prev.map((entry, idx) => {
        if (idx !== index) return entry;
        if (entry.brandImagePreview) URL.revokeObjectURL(entry.brandImagePreview);
        return {
          ...entry,
          brandImageFile: file,
          brandImagePreview: URL.createObjectURL(file),
        };
      }),
    );
  };

  const addSystemBrandRow = () => {
    setSystemBrandEntries((prev) => [...prev, createSystemBrandEntry()]);
  };

  const removeSystemBrandRow = (index) => {
    setSystemBrandEntries((prev) => {
      if (prev.length === 1) return prev;
      const target = prev[index];
      if (target?.brandImagePreview) URL.revokeObjectURL(target.brandImagePreview);
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const maybeAssignBuildingForConsultant = async (baseBuildingName, user) => {
    const creatorEmail = normalizeText(user?.email || "");
    const creatorRole = normalizeText(user?.role || "");
    if (!creatorEmail || !isConsultantLikeRole(creatorRole)) return;
    try {
      const result = await FirestoreService.assignBuildingsToUserByEmail(creatorEmail, [baseBuildingName]);
      if (!result?.success) {
        console.warn("Consultant assignment to user failed:", result?.message || "Unknown error");
      }
    } catch (assignError) {
      console.warn("Consultant assignment post-step failed:", assignError);
    }
  };

  const handleAddBuilding = async () => {
    if (!buildingName.trim()) {
      toast({ title: "Error", description: "Building name is required", variant: "destructive" });
      return;
    }
    if (!normalizeText(jobType) || !normalizeText(job)) {
      toast({ title: "Error", description: "Job type and job are required", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const cleanBuildingName = buildingName.trim();
      const buildingCollectionName = `${cleanBuildingName}BuildingDB`;
      
      // Check if building already exists
      try {
        const existingBuildingRef = doc(db, buildingCollectionName, "buildingDetails");
        const existingBuilding = await getDoc(existingBuildingRef);
        
        if (existingBuilding.exists()) {
          toast({ 
            title: "Error", 
            description: `Building with name '${cleanBuildingName}' already exists. Please choose a different name.`, 
            variant: "destructive" 
          });
          setLoading(false);
          return;
        }
      } catch (checkError) {
        // If we can't check, continue anyway
        console.warn("Could not check for existing building:", checkError);
      }
      
      try {
          // Create skeleton documents including alarmMessage (uses alarmMessage field)
          await FirestoreService.createBuildingSkeleton(cleanBuildingName);

          // Upload optional building image to Firebase Storage
          let buildingImage = "";
          if (buildingImageFile) {
            const ext = buildingImageFile.name.split(".").pop() || "jpg";
            const storageRef = ref(storage, `buildings/${cleanBuildingName}/buildingImage.${ext}`);
            await uploadBytes(storageRef, buildingImageFile);
            buildingImage = await getDownloadURL(storageRef);
          }

          const rowsWithBrandNoSystem = systemBrandEntries.filter(
            (entry) => normalizeText(entry.brandName) && !normalizeText(entry.system),
          );
          if (rowsWithBrandNoSystem.length > 0) {
            toast({
              title: "Error",
              description: "Please select a system for each system brand row.",
              variant: "destructive",
            });
            setLoading(false);
            return;
          }

          const persistedSystemBrands = [];
          const validSystemBrands = systemBrandEntries.filter(
            (entry) => normalizeText(entry.brandName) && normalizeText(entry.system),
          );
          for (let index = 0; index < validSystemBrands.length; index += 1) {
            const entry = validSystemBrands[index];
            let brandImageUrl = "";
            if (entry.brandImageFile) {
              const ext = entry.brandImageFile.name.split(".").pop() || "jpg";
              const storageRef = ref(
                storage,
                `buildings/${cleanBuildingName}/systemBrands/${Date.now()}_${index}.${ext}`,
              );
              await uploadBytes(storageRef, entry.brandImageFile);
              brandImageUrl = await getDownloadURL(storageRef);
            }
            persistedSystemBrands.push({
              category: normalizeText(entry.category) || null,
              system: normalizeText(entry.system),
              subsystem: normalizeText(entry.subsystem) || null,
              subsubsystem: normalizeText(entry.subsubsystem) || null,
              brandName: normalizeText(entry.brandName),
              brandImageUrl: brandImageUrl || null,
            });
          }

          const assignUser = getStoredSessionUser();
          const isConsultantUser =
            isConsultantLikeRole(assignUser?.role);
          let enquiryIdToAssign = "";
          if (isConsultantUser) {
            const salesNames =
              assignUser?.email != null
                ? await fetchSalesBuildingBaseNames(assignUser.email, assignUser.role || "user")
                : [];
            const enquirySeq = await computeNextEnquirySequence([...salesNames, cleanBuildingName]);
            enquiryIdToAssign = formatEnquiryId(enquirySeq);
          }

          // Save building details
          const buildingDetailsRef = doc(db, buildingCollectionName, "buildingDetails");
          const emptyContact = sanitizeContactDetails(createContactDetails());
          const isProject = normalizeText(jobType) === "Project";
          const buildingDetailsPayload = {
            floorDetails: normalizeText(floorDetails),
            location: normalizeText(location),
            buildingStatus: "construction",
            locationData: normalizeText(plotNumber),
            mapData: normalizeText(mapData),
            jobType: normalizeText(jobType),
            job: normalizeText(job),
            ...(isProject
              ? {
                  fitOutCompanyContactDetails: sanitizeContactDetails(fitOutCompanyContactDetails),
                  mainContractorCompanyContactDetails: sanitizeContactDetails(mainContractorCompanyContactDetails),
                  mepContractorCompanyContactDetails: sanitizeContactDetails(mepContractorCompanyContactDetails),
                  consultantCompanyContactDetails: sanitizeContactDetails(consultantCompanyContactDetails),
                  fitOutOperatorDetails: deleteField(),
                  mainContractorOperatorDetails: deleteField(),
                  mepContractorOperatorDetails: deleteField(),
                  consultantOperatorDetails: deleteField(),
                  fitOutContractorContactDetails: deleteField(),
                  mainContractorContactDetails: deleteField(),
                  mepContractorContactDetails: deleteField(),
                  consultantContactDetails: deleteField(),
                  fmCompany: "",
                  flsOperator: "",
                  operator: "",
                  fmCompanyContactDetails: emptyContact,
                  operatorDetails: emptyContact,
                }
              : {
                  fmCompany: normalizeText(fmCompany),
                  flsOperator: normalizeText(flsOperator),
                  operator: normalizeText(flsOperator),
                  fmCompanyContactDetails: sanitizeContactDetails(fmCompanyContactDetails),
                  operatorDetails: sanitizeContactDetails(operatorDetails),
                  fitOutCompanyContactDetails: emptyContact,
                  mainContractorCompanyContactDetails: emptyContact,
                  mepContractorCompanyContactDetails: emptyContact,
                  consultantCompanyContactDetails: emptyContact,
                  fitOutOperatorDetails: deleteField(),
                  mainContractorOperatorDetails: deleteField(),
                  mepContractorOperatorDetails: deleteField(),
                  consultantOperatorDetails: deleteField(),
                  fitOutContractorContactDetails: deleteField(),
                  mainContractorContactDetails: deleteField(),
                  mepContractorContactDetails: deleteField(),
                  consultantContactDetails: deleteField(),
                }),
            system: {
              fireAlarmBrand: normalizeText(fireAlarmBrand),
              fireFightingBrand: normalizeText(fireFightingBrand),
            },
            systemBrands: persistedSystemBrands,
            ...(isProject
              ? { firstPpmDate: deleteField(), lastPPMDate: deleteField() }
              : {
                  firstPpmDate: getTimestampAtNoon(firstPpmDate),
                  lastPPMDate: deleteField(),
                }),
            buildingImage,
            updatedAt: new Date(),
          };
          if (enquiryIdToAssign) {
            buildingDetailsPayload.enquiryId = enquiryIdToAssign;
          }

          await setDoc(
            buildingDetailsRef,
            buildingDetailsPayload,
            { merge: true }
          );

          if (isConsultantUser && assignUser?.email) {
            const salesCommunity = await resolveSalesCommunity(
              assignUser.email,
              assignUser.role || "consultant",
            );
            if (salesCommunity?.id) {
              try {
                // Assign building to SALES community using Firebase SDK
                const communityRef = doc(db, "communities", salesCommunity.id);
                const communityDoc = await getDoc(communityRef);
                
                if (communityDoc.exists()) {
                  const currentBuildings = communityDoc.data().buildings || [];
                  const allBuildings = [...new Set([...currentBuildings, cleanBuildingName])];
                  
                  // Update community with new building
                  await setDoc(
                    communityRef,
                    {
                      buildings: allBuildings,
                      totalBuildings: allBuildings.length,
                      updatedAt: new Date(),
                      updatedBy: assignUser.email || "system",
                    },
                    { merge: true }
                  );
                  
                  // Update building's buildingDetails with community information
                  const buildingDetailsRef = doc(db, buildingCollectionName, "buildingDetails");
                  await setDoc(
                    buildingDetailsRef,
                    {
                      communityId: salesCommunity.id,
                      communityName: salesCommunity.communityName,
                      updatedAt: new Date(),
                    },
                    { merge: true }
                  );
                  
                  console.log("Successfully assigned consultant building to SALES community");
                } else {
                  console.warn("SALES community document not found in Firestore");
                }
              } catch (salesAssignError) {
                console.warn(
                  "Failed to assign consultant building to SALES community:",
                  salesAssignError,
                );
              }
            } else {
              console.warn("SALES community not found. Building created without auto-assignment.");
            }
          }

          await maybeAssignBuildingForConsultant(cleanBuildingName, assignUser);

          console.log("Building saved with consultant-aware details");
          
          toast({ 
            title: "Success", 
            description: `Building "${cleanBuildingName}" has been created successfully.` 
          });
        } catch (updateError) {
          console.error("Error creating building skeleton or updating building details:", updateError);
          toast({
            title: "Error",
            description: "Failed to create building structure: " + (updateError.message || "Unknown error"),
            variant: "destructive"
          });
          setLoading(false);
          return;
        }
        
        setBuildingName("");
        setFloorDetails("");
        setLocation("");
        setPlotNumber("");
        setMapData("");
        setJobType("Services");
        setJob("");
        setSelectedFitOutCompanyId("");
        setFitOutCompanyContactDetails(createContactDetails());
        setSelectedMainContractorCompanyId("");
        setMainContractorCompanyContactDetails(createContactDetails());
        setSelectedMepContractorCompanyId("");
        setMepContractorCompanyContactDetails(createContactDetails());
        setSelectedConsultantCompanyId("");
        setConsultantCompanyContactDetails(createContactDetails());
        setFmCompany("");
        setSelectedFmCompanyId("");
        setFlsOperator("");
        setSelectedFlsOperatorIdx("");
        setFireAlarmBrand("");
        setFireFightingBrand("");
        setFirstPpmDate("");
        setFmCompanyContactDetails(createContactDetails());
        setOperatorDetails(createContactDetails());
        systemBrandEntries.forEach((entry) => {
          if (entry.brandImagePreview) URL.revokeObjectURL(entry.brandImagePreview);
        });
        setSystemBrandEntries([createSystemBrandEntry()]);
        setBuildingImageFile(null);
        if (buildingImagePreview) {
          URL.revokeObjectURL(buildingImagePreview);
          setBuildingImagePreview("");
        }
        // Refresh buildings list after adding
        const adminUser = parseStoredUser(secureLocalStorage.getItem("user"));
        if (adminUser && adminUser.email) {
          refetchCommunities();
        }
        await refreshNextEnquiryId();
    } catch (error) {
      console.error("Error adding building:", error);
      toast({ 
        title: "Error", 
        description: error.message || "Network error. Please check if the backend server is running.", 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please select a valid image file", variant: "destructive" });
      return;
    }
    if (buildingImagePreview) URL.revokeObjectURL(buildingImagePreview);
    setBuildingImageFile(file);
    setBuildingImagePreview(URL.createObjectURL(file));
  };

  const openEditBuildingDialog = (building) => {
    const cleanBuildingName = normalizeBuildingName(building);
    if (!cleanBuildingName) return;
    setEditingBuildingName(cleanBuildingName);
    setEditBuildingDialogOpen(true);
  };

  // ✅ Only render if logged in
  // if (!loggedIn) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <ModeToggle />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Buildings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Manage Buildings</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <PageHelpBanner />
          <Card className="w-full p-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Add New Building<FaqHelpButton articleId="page-buildings" /></CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="buildingName">Building Name</Label>
              <Input
                id="buildingName"
                type="text"
                placeholder="Enter building name"
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
              />
              {isConsultant ? (
                <div className="mt-4">
                  <Label htmlFor="enquiryId">Enquiry ID</Label>
                  <Input
                    id="enquiryId"
                    type="text"
                    readOnly
                    className="bg-muted/50"
                    value={loadingEnquiryId ? "Resolving..." : nextEnquiryId || "--"}
                    aria-busy={loadingEnquiryId}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Auto-generated as the next Enquiry ID from SALES community buildings.
                  </p>
                </div>
              ) : null}
              <div className="mt-4">
                <Label htmlFor="floorDetails">Floor Details</Label>
                <Input id="floorDetails" type="text" value={floorDetails} onChange={(e) => setFloorDetails(e.target.value)} />
              </div>
              <div className="mt-4">
                <Label htmlFor="location">Location</Label>
                <Input id="location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div className="mt-4">
                <Label htmlFor="plotNumber">Plot Number</Label>
                <Input
                  id="plotNumber"
                  type="text"
                  placeholder="Enter plot number"
                  value={plotNumber}
                  onChange={(e) => setPlotNumber(e.target.value)}
                />
              </div>
              <div className="mt-4">
                <Label htmlFor="mapData">Map Data</Label>
                <Input id="mapData" type="text" placeholder="Lat/Lng notes or map details" value={mapData} onChange={(e) => setMapData(e.target.value)} />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="jobType">Job type</Label>
                  <select
                    id="jobType"
                    value={jobType}
                    onChange={(e) => {
                      setJobType(e.target.value);
                      setJob("");
                    }}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {JOB_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="job">Job</Label>
                  <select
                    id="job"
                    value={job}
                    onChange={(e) => setJob(e.target.value)}
                    disabled={!jobType}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                  >
                    <option value="">Select job</option>
                    {(jobType === "Project"
                      ? PROJECT_JOBS
                      : jobType === "Vision365 Plan"
                        ? VISION365_PLAN_JOBS
                        : SERVICE_JOBS
                    ).map((j) => (
                      <option key={j} value={j}>
                        {j}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {jobType === "Services" ? (
                <>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="fmCompany">FM Company</Label>
                      <select
                        id="fmCompany"
                        value={selectedFmCompanyId}
                        onChange={(e) => {
                          const selectedId = e.target.value;
                          setSelectedFmCompanyId(selectedId);
                          const selectedCompany = fmCompanies.find((item) => item.id === selectedId);
                          if (selectedCompany) {
                            applyFmCompanyToForm(selectedCompany);
                          } else {
                            setFmCompany("");
                            setFlsOperator("");
                            setSelectedFlsOperatorIdx("");
                            setFmCompanyContactDetails(createContactDetails());
                            setOperatorDetails(createContactDetails());
                          }
                        }}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Select FM Company</option>
                        {fmCompanies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company?.companyName || "Unnamed Company"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="flsOperator">FLS Operator</Label>
                      <select
                        id="flsOperator"
                        value={selectedFlsOperatorIdx}
                        onChange={(e) => {
                          const selectedIdx = e.target.value;
                          setSelectedFlsOperatorIdx(selectedIdx);
                          const selectedCompany = fmCompanies.find((item) => item.id === selectedFmCompanyId);
                          const operationsTeam = Array.isArray(selectedCompany?.teams?.operationsTeam)
                            ? selectedCompany.teams.operationsTeam
                            : [];
                          const matchedOperator = selectedIdx === "" ? null : operationsTeam[Number(selectedIdx)];
                          if (matchedOperator) {
                            const {
                              name: operatorName,
                              designation: operatorDesignation,
                              email: operatorEmail,
                              phone: operatorContact,
                            } = extractOperatorDetail(matchedOperator);
                            setFlsOperator(operatorName);
                            setOperatorDetails((prev) => ({
                              name: operatorName || normalizeText(prev.name),
                              designation: operatorDesignation || normalizeText(prev.designation),
                              email: operatorEmail || normalizeText(prev.email),
                              phoneNumbers: operatorContact ? [operatorContact] : [""],
                            }));
                          } else {
                            setFlsOperator("");
                            setOperatorDetails(createContactDetails());
                          }
                        }}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        disabled={!selectedFmCompanyId}
                      >
                        <option value="">Select FLS Operator</option>
                        {(() => {
                          const selectedCompany = fmCompanies.find((item) => item.id === selectedFmCompanyId);
                          const operationsTeam = Array.isArray(selectedCompany?.teams?.operationsTeam)
                            ? selectedCompany.teams.operationsTeam
                            : [];
                          return operationsTeam.map((member, idx) => {
                            const operatorName = normalizeText(member?.name);
                            const operatorPhone = normalizeText(member?.contact || member?.contactNumber);
                            return (
                              <option key={`operator-${idx}`} value={String(idx)}>
                                {operatorName || `Operator ${idx + 1}`}{operatorPhone ? ` - ${operatorPhone}` : ""}
                              </option>
                            );
                          });
                        })()}
                      </select>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Label htmlFor="firstPpmDate">First PPM Date</Label>
                    <Input
                      id="firstPpmDate"
                      type="date"
                      value={firstPpmDate}
                      onChange={(e) => setFirstPpmDate(e.target.value)}
                    />
                  </div>
                  <ContactDetailsBlock
                    title="FM COMPANY"
                    contact={fmCompanyContactDetails}
                    setContact={setFmCompanyContactDetails}
                    updateContactDetail={updateContactDetail}
                    updateContactPhone={updateContactPhone}
                    addContactPhone={addContactPhone}
                    removeContactPhone={removeContactPhone}
                    wrapperClassName="mt-6"
                  />
                  <ContactDetailsBlock
                    title="FLS OPERATORS"
                    contact={operatorDetails}
                    setContact={setOperatorDetails}
                    updateContactDetail={updateContactDetail}
                    updateContactPhone={updateContactPhone}
                    addContactPhone={addContactPhone}
                    removeContactPhone={removeContactPhone}
                  />
                </>
              ) : null}
              {jobType === "Project" ? (
                <>
                  <ProjectContractorPair
                    roleTitle="FIT OUT CONTRACTOR"
                    companyType="FIT OUT CONTRACTOR"
                    companySelectId="fit-out-company"
                    fmCompanies={fmCompanies}
                    companyId={selectedFitOutCompanyId}
                    setCompanyId={setSelectedFitOutCompanyId}
                    companyContact={fitOutCompanyContactDetails}
                    setCompanyContact={setFitOutCompanyContactDetails}
                    applyCompanyFromDoc={(doc) =>
                      applyProjectCompanyToForm(doc, setFitOutCompanyContactDetails)
                    }
                    updateContactDetail={updateContactDetail}
                    updateContactPhone={updateContactPhone}
                    addContactPhone={addContactPhone}
                    removeContactPhone={removeContactPhone}
                    wrapperClassName="mt-6"
                  />
                  <ProjectContractorPair
                    roleTitle="MAIN CONTRACTOR"
                    companyType="MAIN CONTRACTOR"
                    companySelectId="main-contractor-company"
                    fmCompanies={fmCompanies}
                    companyId={selectedMainContractorCompanyId}
                    setCompanyId={setSelectedMainContractorCompanyId}
                    companyContact={mainContractorCompanyContactDetails}
                    setCompanyContact={setMainContractorCompanyContactDetails}
                    applyCompanyFromDoc={(doc) =>
                      applyProjectCompanyToForm(doc, setMainContractorCompanyContactDetails)
                    }
                    updateContactDetail={updateContactDetail}
                    updateContactPhone={updateContactPhone}
                    addContactPhone={addContactPhone}
                    removeContactPhone={removeContactPhone}
                  />
                  <ProjectContractorPair
                    roleTitle="MEP CONTRACTOR"
                    companyType="MEP CONTRACTOR"
                    companySelectId="mep-contractor-company"
                    fmCompanies={fmCompanies}
                    companyId={selectedMepContractorCompanyId}
                    setCompanyId={setSelectedMepContractorCompanyId}
                    companyContact={mepContractorCompanyContactDetails}
                    setCompanyContact={setMepContractorCompanyContactDetails}
                    applyCompanyFromDoc={(doc) =>
                      applyProjectCompanyToForm(doc, setMepContractorCompanyContactDetails)
                    }
                    updateContactDetail={updateContactDetail}
                    updateContactPhone={updateContactPhone}
                    addContactPhone={addContactPhone}
                    removeContactPhone={removeContactPhone}
                  />
                  <ProjectContractorPair
                    roleTitle="CONSULTANT"
                    companyType="CONSULTANT"
                    companySelectId="consultant-company"
                    fmCompanies={fmCompanies}
                    companyId={selectedConsultantCompanyId}
                    setCompanyId={setSelectedConsultantCompanyId}
                    companyContact={consultantCompanyContactDetails}
                    setCompanyContact={setConsultantCompanyContactDetails}
                    applyCompanyFromDoc={(doc) =>
                      applyProjectCompanyToForm(doc, setConsultantCompanyContactDetails)
                    }
                    updateContactDetail={updateContactDetail}
                    updateContactPhone={updateContactPhone}
                    addContactPhone={addContactPhone}
                    removeContactPhone={removeContactPhone}
                  />
                </>
              ) : null}
              <div className="mt-4 rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">System Brand Mapping</h3>
                  <Button type="button" variant="outline" onClick={addSystemBrandRow}>Add Row</Button>
                </div>
                {systemBrandEntries.map((entry, index) => (
                  <div key={`system-brand-${index}`} className="mt-4 rounded border p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <select
                        value={entry.category}
                        onChange={(e) => handleSystemBrandChange(index, "category", e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Select Category</option>
                        {brandCategoryOptions().map((categoryOption) => (
                          <option key={categoryOption} value={categoryOption}>
                            {categoryOption}
                          </option>
                        ))}
                      </select>
                      <select
                        value={entry.system}
                        onChange={(e) => handleSystemBrandChange(index, "system", e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        disabled={!entry.category}
                      >
                        <option value="">Select System</option>
                        {getSystems().map((systemOption) => (
                          <option key={systemOption} value={systemOption}>
                            {formatSystemOption(systemOption)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={entry.subsystem}
                        onChange={(e) => handleSystemBrandChange(index, "subsystem", e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        disabled={!entry.system}
                      >
                        <option value="">Main category only</option>
                        {getSubsystems(entry.system).map((subsystemOption) => (
                          <option key={subsystemOption} value={subsystemOption}>
                            {subsystemOption}
                          </option>
                        ))}
                      </select>
                      <select
                        value={entry.subsubsystem}
                        onChange={(e) => handleSystemBrandChange(index, "subsubsystem", e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        disabled={!entry.system || !entry.subsystem}
                      >
                        <option value="">This subsystem only</option>
                        {getSubsubsystems(entry.system, entry.subsystem).map((subsubsystemOption) => (
                          <option key={subsubsystemOption} value={subsubsystemOption}>
                            {subsubsystemOption}
                          </option>
                        ))}
                      </select>
                      <div className="space-y-2">
                        <select
                          value={
                            getBrandOptionsForSystemPath(
                              entry.category,
                              entry.system,
                              entry.subsystem,
                              entry.subsubsystem,
                            ).includes(entry.brandName)
                              ? entry.brandName
                              : entry.brandName
                                ? "__custom__"
                                : ""
                          }
                          onChange={(e) => {
                            const value = e.target.value;
                            handleSystemBrandChange(index, "brandName", value === "__custom__" ? "" : value);
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          disabled={!entry.category}
                        >
                          <option value="">Select Brand</option>
                          {getBrandOptionsForSystemPath(
                            entry.category,
                            entry.system,
                            entry.subsystem,
                            entry.subsubsystem,
                          ).map((brandOption) => (
                            <option key={brandOption} value={brandOption}>
                              {brandOption}
                            </option>
                          ))}
                          <option value="__custom__">Custom brand</option>
                        </select>
                        {(!getBrandOptionsForSystemPath(
                          entry.category,
                          entry.system,
                          entry.subsystem,
                          entry.subsubsystem,
                        ).includes(entry.brandName) ||
                          !entry.brandName) && (
                          <Input
                            placeholder="Brand Name"
                            value={entry.brandName}
                            onChange={(e) => handleSystemBrandChange(index, "brandName", e.target.value)}
                          />
                        )}
                      </div>
                      <Input type="file" accept="image/*" onChange={(e) => handleSystemBrandImage(index, e.target.files?.[0])} />
                    </div>
                    {entry.brandImagePreview ? (
                      <img src={entry.brandImagePreview} alt="Brand preview" className="mt-3 h-20 w-28 rounded border object-cover" />
                    ) : null}
                    <Button type="button" variant="outline" className="mt-3" onClick={() => removeSystemBrandRow(index)}>Remove Row</Button>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Label htmlFor="buildingImage">Building Image (optional)</Label>
                <div
                  className="mt-2 border-2 border-dashed border-muted-foreground/30 rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <p className="text-sm text-muted-foreground">
                    {buildingImageFile ? buildingImageFile.name : "Click to select an image"}
                  </p>
                </div>
                <input
                  ref={imageInputRef}
                  id="buildingImage"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
                {buildingImagePreview && (
                  <img
                    src={buildingImagePreview}
                    alt="Building preview"
                    className="mt-3 h-24 w-36 object-cover rounded border"
                  />
                )}
              </div>
              <Button className="w-full mt-4" onClick={handleAddBuilding} disabled={loading || !buildingName.trim()}>
                {loading ? "Adding..." : "Add Building"}
              </Button>
            </CardContent>
          </Card>
          <Card className="w-full p-4 mt-4">
            <CardHeader>
              <CardTitle>Building Name</CardTitle>
            </CardHeader>
            <CardContent>
              {fetchingBuildings ? (
                <p className="text-muted-foreground">Loading buildings...</p>
              ) : buildings.length === 0 ? (
                <p className="text-muted-foreground">No buildings available. Add a building above.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Building Name</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buildings.map((building, index) => (
                      <TableRow key={index}>
                        <TableCell>{building}</TableCell>
                        <TableCell className="text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEditBuildingDialog(building)}>
                            Edit Full Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <BuildingDetailsEditDialog
            open={editBuildingDialogOpen}
            onOpenChange={setEditBuildingDialogOpen}
            buildingName={editingBuildingName}
            fmCompanies={fmCompanies}
            isConsultant={isConsultant}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
