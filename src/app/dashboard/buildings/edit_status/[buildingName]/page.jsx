"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePageAuth } from "@/hooks/usePageAuth";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import FirestoreService from "@/services/firestoreService";
import {
  getBrandOptionsFromRegistry,
  loadBrandRegistry,
} from "@/utils/brandRegistryService";
import { db } from "@/config/firebase";
import { collection, getDocs } from "firebase/firestore";

const createContact = () => ({
  name: "",
  designation: "",
  email: "",
  phoneNumbers: [""],
});

const createSystemBrandEntry = () => ({
  category: "",
  system: "",
  subsystem: "",
  subsubsystem: "",
  brandName: "",
});

const SYSTEM_OPTIONS = ["FA", "FF", "CBS", "CMS", "PAVE", "SCL"];
const SYSTEM_LABELS = {
  FA: "Fire Alarm",
  FF: "Fire Fighting",
  CBS: "Central Battery System",
  CMS: "Central Monitoring System",
  PAVE: "Public Address / Voice Evacuation",
  SCL: "Smoke Control",
};
const SYSTEM_BRAND_STRUCTURE = {
  FA: {
    "Control Panels": ["Main FACP", "Repeater Panels", "Network Nodes"],
    "Initiating Devices": [
      "Smoke Detectors",
      "Heat Detectors",
      "Manual Call Points",
      "Beam Detectors",
    ],
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

const formatSystemOption = (code) => {
  const label = SYSTEM_LABELS[code];
  return label ? `${code} — ${label}` : code;
};

const asDateOrNull = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const toStringArray = (value) => {
  const arr = Array.isArray(value) ? value : [];
  const cleaned = arr.map((v) => String(v || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned : [""];
};

const toSystemBrandEntries = (value) => {
  const entries = Array.isArray(value) ? value : [];
  if (!entries.length) return [createSystemBrandEntry()];
  return entries.map((entry) => ({
    category: String(entry?.category || ""),
    system: String(entry?.system || ""),
    subsystem: String(entry?.subsystem || ""),
    subsubsystem: String(entry?.subsubsystem || ""),
    brandName: String(entry?.brandName || ""),
  }));
};

export default function EditBuildingDetailsPage() {
  const { isReady, isAuthenticated } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const imageInputRef = useRef(null);
  const buildingName = useMemo(
    () => decodeURIComponent(String(params?.buildingName || "")),
    [params?.buildingName],
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [floorDetails, setFloorDetails] = useState("");
  const [location, setLocation] = useState("");
  const [locationData, setLocationData] = useState("");
  const [mapData, setMapData] = useState("");
  const [fmCompany, setFmCompany] = useState("");
  const [flsOperator, setFlsOperator] = useState("");
  const [fmCompanyContactDetails, setFmCompanyContactDetails] =
    useState(createContact());
  const [operatorDetails, setOperatorDetails] = useState(createContact());
  const [systemBrandEntries, setSystemBrandEntries] = useState([
    createSystemBrandEntry(),
  ]);
  const [brandRegistry, setBrandRegistry] = useState([]);
  const [firstPpmDate, setFirstPpmDate] = useState("");
  const [imageUri, setImageUri] = useState(null);
  const [imageMime, setImageMime] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [existingImage, setExistingImage] = useState("");

  useEffect(() => {
    if (!isReady || !isAuthenticated) return;

    if (!buildingName) {
      toast({
        title: "Error",
        description: "Missing building name.",
        variant: "destructive",
      });
      router.back();
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const details = await FirestoreService.getBuildingInfo(buildingName);
        if (!details) {
          toast({
            title: "Not found",
            description: `No details found for ${buildingName}.`,
            variant: "destructive",
          });
          router.back();
          return;
        }

        setFloorDetails(String(details.floorDetails || ""));
        setLocation(String(details.location || ""));
        setLocationData(String(details.locationData || ""));
        setMapData(String(details.mapData || ""));
        setFmCompany(String(details.fmCompany || ""));
        setFlsOperator(String(details.flsOperator || details.operator || ""));
        setFmCompanyContactDetails({
          name: String(details.fmCompanyContactDetails?.name || ""),
          designation: String(details.fmCompanyContactDetails?.designation || ""),
          email: String(details.fmCompanyContactDetails?.email || ""),
          phoneNumbers: toStringArray(details.fmCompanyContactDetails?.phoneNumbers),
        });
        setOperatorDetails({
          name: String(details.operatorDetails?.name || ""),
          designation: String(details.operatorDetails?.designation || ""),
          email: String(details.operatorDetails?.email || ""),
          phoneNumbers: toStringArray(details.operatorDetails?.phoneNumbers),
        });
        setSystemBrandEntries(toSystemBrandEntries(details.systemBrands));
        const parsedDate = asDateOrNull(details.firstPpmDate);
        setFirstPpmDate(
          parsedDate ? parsedDate.toISOString().split("T")[0] : "",
        );
        setExistingImage(
          String(details.buildingImage || details.buildingImageUrl || ""),
        );
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to load building details.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [buildingName, isReady, isAuthenticated, router, toast]);

  useEffect(() => {
    const loadRegistry = async () => {
      try {
        const rows = await loadBrandRegistry(db, getDocs, collection);
        setBrandRegistry(rows);
      } catch {
        setBrandRegistry([]);
      }
    };
    loadRegistry();
  }, []);

  const updatePhone = (setter, state, idx, value) => {
    const next = [...state.phoneNumbers];
    next[idx] = value;
    setter({ ...state, phoneNumbers: next });
  };

  const addPhone = (setter, state) => {
    setter({ ...state, phoneNumbers: [...state.phoneNumbers, ""] });
  };

  const removePhone = (setter, state, idx) => {
    if (state.phoneNumbers.length <= 1) return;
    setter({
      ...state,
      phoneNumbers: state.phoneNumbers.filter((_, index) => index !== idx),
    });
  };

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please choose an image.",
        variant: "destructive",
      });
      return;
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageUri(file);
    setImageMime(file.type || "");
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSystemBrandChange = (index, key, value) => {
    setSystemBrandEntries((prev) =>
      prev.map((entry, idx) => {
        if (idx !== index) return entry;
        if (key === "category") {
          return {
            ...entry,
            category: value,
            system: "",
            subsystem: "",
            subsubsystem: "",
            brandName: "",
          };
        }
        if (key === "system") {
          return {
            ...entry,
            system: value,
            subsystem: "",
            subsubsystem: "",
            brandName: "",
          };
        }
        if (key === "subsystem") {
          return { ...entry, subsystem: value, subsubsystem: "", brandName: "" };
        }
        return { ...entry, [key]: value };
      }),
    );
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
  const brandCategoryOptions = useMemo(() => {
    const out = new Set();
    brandRegistry.forEach((row) => {
      (row?.categories || []).forEach((c) => {
        const trimmed = String(c || "").trim();
        if (trimmed) out.add(trimmed);
      });
      const single = String(row?.category || "").trim();
      if (single) out.add(single);
    });
    return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [brandRegistry]);
  const getBrandOptionsForSystemPath = (category, system, subsystem, subsubsystem) => {
    const scoped = getBrandOptionsFromRegistry(brandRegistry, {
      category,
      system,
      subsystem,
      subsubsystem,
    });
    if (scoped.length) return scoped;
    if (String(category || "").trim()) {
      return getBrandOptionsFromRegistry(brandRegistry, { category });
    }
    return getBrandOptionsFromRegistry(brandRegistry, {});
  };

  const handleSave = async () => {
    if (!buildingName) return;
    setSaving(true);
    try {
      const result = await FirestoreService.updateBuildingWithForm(
        buildingName,
        {
          floorDetails,
          location,
          locationData,
          mapData,
          fmCompany,
          flsOperator,
          fmCompanyContactDetails,
          operatorDetails,
          systemBrandEntries,
          firstPpmDate: firstPpmDate ? new Date(`${firstPpmDate}T12:00:00`) : null,
        },
        { localImageUri: imageUri, imageMime },
      );

      if (!result.success) {
        toast({
          title: "Save failed",
          description: result.message || "Could not save building details.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Saved", description: "Building updated successfully." });
      router.back();
    } catch (error) {
      toast({
        title: "Error",
        description: "Unexpected error while saving.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
                <BreadcrumbLink href="/dashboard/buildings/edit_status">
                  Edit Building
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{buildingName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Edit Building Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Building Name</Label>
                <Input value={buildingName} disabled />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <Label>Floor Details</Label>
                  <Input value={floorDetails} onChange={(e) => setFloorDetails(e.target.value)} />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
                <div>
                  <Label>Plot Number</Label>
                  <Input value={locationData} onChange={(e) => setLocationData(e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Stored in <code>locationData</code> as the plot number.
                  </p>
                </div>
                <div>
                  <Label>Map Data</Label>
                  <Input value={mapData} onChange={(e) => setMapData(e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Stored in <code>mapData</code> as map text or lat,lng coordinates.
                  </p>
                </div>
                <div>
                  <Label>FM Company</Label>
                  <Input value={fmCompany} onChange={(e) => setFmCompany(e.target.value)} />
                </div>
                <div>
                  <Label>FLS Operator</Label>
                  <Input value={flsOperator} onChange={(e) => setFlsOperator(e.target.value)} />
                </div>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">FM Company Contact</p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Input placeholder="Name" value={fmCompanyContactDetails.name} onChange={(e) => setFmCompanyContactDetails({ ...fmCompanyContactDetails, name: e.target.value })} />
                  <Input placeholder="Designation" value={fmCompanyContactDetails.designation} onChange={(e) => setFmCompanyContactDetails({ ...fmCompanyContactDetails, designation: e.target.value })} />
                  <Input placeholder="Email" value={fmCompanyContactDetails.email} onChange={(e) => setFmCompanyContactDetails({ ...fmCompanyContactDetails, email: e.target.value })} />
                </div>
                {fmCompanyContactDetails.phoneNumbers.map((phone, idx) => (
                  <div key={`fm-${idx}`} className="mt-2 flex gap-2">
                    <Input value={phone} onChange={(e) => updatePhone(setFmCompanyContactDetails, fmCompanyContactDetails, idx, e.target.value)} />
                    <Button type="button" variant="outline" onClick={() => removePhone(setFmCompanyContactDetails, fmCompanyContactDetails, idx)}>Remove</Button>
                  </div>
                ))}
                <Button type="button" variant="outline" className="mt-2" onClick={() => addPhone(setFmCompanyContactDetails, fmCompanyContactDetails)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Phone
                </Button>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Operator Contact</p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Input placeholder="Name" value={operatorDetails.name} onChange={(e) => setOperatorDetails({ ...operatorDetails, name: e.target.value })} />
                  <Input placeholder="Designation" value={operatorDetails.designation} onChange={(e) => setOperatorDetails({ ...operatorDetails, designation: e.target.value })} />
                  <Input placeholder="Email" value={operatorDetails.email} onChange={(e) => setOperatorDetails({ ...operatorDetails, email: e.target.value })} />
                </div>
                {operatorDetails.phoneNumbers.map((phone, idx) => (
                  <div key={`op-${idx}`} className="mt-2 flex gap-2">
                    <Input value={phone} onChange={(e) => updatePhone(setOperatorDetails, operatorDetails, idx, e.target.value)} />
                    <Button type="button" variant="outline" onClick={() => removePhone(setOperatorDetails, operatorDetails, idx)}>Remove</Button>
                  </div>
                ))}
                <Button type="button" variant="outline" className="mt-2" onClick={() => addPhone(setOperatorDetails, operatorDetails)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Phone
                </Button>
              </div>

              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">System Brands</p>
                  <Button type="button" variant="outline" onClick={() => setSystemBrandEntries((prev) => [...prev, createSystemBrandEntry()])}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Row
                  </Button>
                </div>
                <div className="mt-3 rounded border border-dashed p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Saved Brand Mappings
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {systemBrandEntries
                      .filter((entry) => String(entry.brandName || "").trim())
                      .map((entry, idx) => (
                        <span
                          key={`mapped-brand-${idx}`}
                          className="rounded-full bg-muted px-2 py-1 text-xs"
                        >
                          {entry.brandName}
                          {entry.system ? ` (${entry.system})` : ""}
                        </span>
                      ))}
                    {!systemBrandEntries.some((entry) => String(entry.brandName || "").trim()) && (
                      <span className="text-xs text-muted-foreground">
                        No brand mappings added yet.
                      </span>
                    )}
                  </div>
                </div>
                {systemBrandEntries.map((entry, index) => (
                  <div key={`sb-${index}`} className="mt-3 rounded border p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <select
                        value={entry.category}
                        onChange={(e) =>
                          handleSystemBrandChange(index, "category", e.target.value)
                        }
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Select Category</option>
                        {brandCategoryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <select
                        value={entry.system}
                        onChange={(e) =>
                          handleSystemBrandChange(index, "system", e.target.value)
                        }
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
                        onChange={(e) =>
                          handleSystemBrandChange(index, "subsystem", e.target.value)
                        }
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
                        onChange={(e) =>
                          handleSystemBrandChange(index, "subsubsystem", e.target.value)
                        }
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        disabled={!entry.system || !entry.subsystem}
                      >
                        <option value="">This subsystem only</option>
                        {getSubsubsystems(entry.system, entry.subsystem).map((leaf) => (
                          <option key={leaf} value={leaf}>
                            {leaf}
                          </option>
                        ))}
                      </select>
                      <div className="space-y-2 md:col-span-2">
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
                            handleSystemBrandChange(
                              index,
                              "brandName",
                              value === "__custom__" ? "" : value,
                            );
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
                            onChange={(e) =>
                              handleSystemBrandChange(
                                index,
                                "brandName",
                                e.target.value,
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        if (systemBrandEntries.length <= 1) return;
                        setSystemBrandEntries((prev) =>
                          prev.filter((_, idx) => idx !== index),
                        );
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove Row
                    </Button>
                  </div>
                ))}
              </div>

              <div>
                <Label>First PPM Date</Label>
                <Input
                  type="date"
                  value={firstPpmDate}
                  onChange={(e) => setFirstPpmDate(e.target.value)}
                />
              </div>

              <div>
                <Label>Building Image (optional)</Label>
                <div className="mt-2 flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => imageInputRef.current?.click()}>
                    Choose Image
                  </Button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageSelect}
                  />
                </div>
                {(imagePreview || existingImage) && (
                  <img
                    src={imagePreview || existingImage}
                    alt="Building preview"
                    className="mt-2 h-24 w-36 rounded border object-cover"
                  />
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save building"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
