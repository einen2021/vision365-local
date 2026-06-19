"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db, storage } from "@/config/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getBrandOptionsFromRegistry, loadBrandRegistry } from "@/utils/brandRegistryService";
import {
  JOB_TYPES,
  PROJECT_JOBS,
  SERVICE_JOBS,
  VISION365_PLAN_JOBS,
  BUILDING_STATUS_OPTIONS,
  SYSTEM_BRAND_STRUCTURE,
  SYSTEM_OPTIONS,
  createSystemBrandEntry,
  formatSystemOption,
} from "@/config/buildingFormConstants";
import {
  buildBuildingDetailsPayload,
  createContactDetails,
  detailsToEditForm,
  extractOperatorDetail,
  normalizeText,
  systemBrandsFromDetails,
} from "@/lib/buildingDetailsFormUtils";

import { normalizeBuildingName } from "@/lib/buildingNames";

function ContactDetailsBlock({
  title,
  contact,
  onChange,
  wrapperClassName = "mt-4",
}) {
  const updateField = (key, value) => onChange({ ...contact, [key]: value });
  const updatePhone = (idx, value) => {
    const next = [...contact.phoneNumbers];
    next[idx] = value;
    onChange({ ...contact, phoneNumbers: next });
  };
  const addPhone = () => onChange({ ...contact, phoneNumbers: [...contact.phoneNumbers, ""] });
  const removePhone = (idx) => {
    if (contact.phoneNumbers.length <= 1) return;
    onChange({ ...contact, phoneNumbers: contact.phoneNumbers.filter((_, i) => i !== idx) });
  };

  return (
    <div className={`${wrapperClassName} rounded-md border p-4`}>
      <h3 className="font-medium">{title}</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input placeholder="Name" value={contact.name} onChange={(e) => updateField("name", e.target.value)} />
        <Input
          placeholder="Designation"
          value={contact.designation}
          onChange={(e) => updateField("designation", e.target.value)}
        />
        <Input placeholder="Email" value={contact.email} onChange={(e) => updateField("email", e.target.value)} />
      </div>
      {contact.phoneNumbers.map((phone, idx) => (
        <div key={`${title}-phone-${idx}`} className="mt-3 flex gap-2">
          <Input
            placeholder={`Phone ${idx + 1}`}
            value={phone}
            onChange={(e) => updatePhone(idx, e.target.value)}
          />
          <Button type="button" variant="outline" onClick={() => removePhone(idx)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="mt-3" onClick={addPhone}>
        Add Phone
      </Button>
    </div>
  );
}

function ProjectContractorBlock({
  roleTitle,
  companyType,
  companySelectId,
  fmCompanies,
  companyId,
  onCompanyIdChange,
  contact,
  onContactChange,
  wrapperClassName = "mt-4",
}) {
  const filtered = fmCompanies.filter(
    (c) =>
      String(c?.companyType || "").trim().toLowerCase() ===
      String(companyType || "").trim().toLowerCase(),
  );

  const applyCompany = (companyDoc) => {
    if (!companyDoc) {
      onContactChange(createContactDetails());
      return;
    }
    onContactChange({
      name: normalizeText(companyDoc?.companyName),
      designation: normalizeText(companyDoc?.companyAddress),
      email: normalizeText(companyDoc?.emailId),
      phoneNumbers: normalizeText(companyDoc?.contactNumber) ? [normalizeText(companyDoc.contactNumber)] : [""],
    });
  };

  return (
    <>
      <div className={wrapperClassName}>
        <Label htmlFor={companySelectId}>{roleTitle} — company</Label>
        <select
          id={companySelectId}
          value={companyId}
          onChange={(e) => {
            const selectedId = e.target.value;
            onCompanyIdChange(selectedId);
            const docRow = fmCompanies.find((item) => item.id === selectedId);
            applyCompany(docRow);
          }}
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select company</option>
          {filtered.map((company) => (
            <option key={company.id} value={company.id}>
              {company?.companyName || "Unnamed company"}
            </option>
          ))}
        </select>
      </div>
      <ContactDetailsBlock title={roleTitle} contact={contact} onChange={onContactChange} wrapperClassName="mt-3" />
    </>
  );
}

export function BuildingDetailsEditDialog({
  open,
  onOpenChange,
  buildingName,
  fmCompanies = [],
  isConsultant = false,
  onSaved,
}) {
  const { toast } = useToast();
  const imageInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brandRegistry, setBrandRegistry] = useState([]);
  const [form, setForm] = useState(null);
  const [systemBrandEntries, setSystemBrandEntries] = useState([createSystemBrandEntry()]);
  const [buildingImageFile, setBuildingImageFile] = useState(null);
  const [buildingImagePreview, setBuildingImagePreview] = useState("");
  const [contractorCompanyIds, setContractorCompanyIds] = useState({
    fitOut: "",
    main: "",
    mep: "",
    consultant: "",
  });

  const patchForm = (patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const fetchBrandRegistry = useCallback(async () => {
    try {
      const rows = await loadBrandRegistry();
      setBrandRegistry(rows || []);
    } catch {
      setBrandRegistry([]);
    }
  }, []);

  useEffect(() => {
    if (open) fetchBrandRegistry();
  }, [open, fetchBrandRegistry]);

  useEffect(() => {
    if (!open || !buildingName) return;
    const cleanName = normalizeBuildingName(buildingName);
    if (!cleanName) return;

    let cancelled = false;
    setLoading(true);
    setForm(null);
    setBuildingImageFile(null);
    setBuildingImagePreview("");
    setContractorCompanyIds({ fitOut: "", main: "", mep: "", consultant: "" });

    (async () => {
      try {
        const detailsRef = doc(db, `${cleanName}BuildingDB`, "buildingDetails");
        const snap = await getDoc(detailsRef);
        const details = snap.exists() ? snap.data() : {};
        if (cancelled) return;
        const hydrated = detailsToEditForm(details, cleanName, fmCompanies);
        setForm(hydrated);
        setSystemBrandEntries(systemBrandsFromDetails(details.systemBrands));
        if (hydrated.existingBuildingImage) {
          setBuildingImagePreview(hydrated.existingBuildingImage);
        }
      } catch {
        if (!cancelled) {
          toast({ title: "Error", description: "Failed to load building details.", variant: "destructive" });
          setForm(detailsToEditForm({}, cleanName, fmCompanies));
          setSystemBrandEntries([createSystemBrandEntry()]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, buildingName, fmCompanies, toast]);

  const applyFmCompanyToForm = (companyDoc) => {
    if (!companyDoc || !form) return;
    const companyName = normalizeText(companyDoc?.companyName);
    const companyContact = normalizeText(companyDoc?.contactNumber);
    const companyEmail = normalizeText(companyDoc?.emailId);
    const companyAddress = normalizeText(companyDoc?.companyAddress);
    const operatorTeam = Array.isArray(companyDoc?.teams?.operationsTeam)
      ? companyDoc.teams.operationsTeam
      : [];
    const firstOperator = operatorTeam[0] || null;
    const { name: operatorName, designation, email, phone } = extractOperatorDetail(firstOperator);

    patchForm({
      fmCompany: companyName,
      selectedFmCompanyId: companyDoc.id,
      flsOperator: operatorName,
      selectedFlsOperatorIdx: firstOperator ? "0" : "",
      fmCompanyContactDetails: {
        name: companyName,
        designation: companyAddress,
        email: companyEmail,
        phoneNumbers: companyContact ? [companyContact] : [""],
      },
      operatorDetails: {
        name: operatorName,
        designation,
        email,
        phoneNumbers: phone ? [phone] : [""],
      },
    });
  };

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

  const getSystems = () => SYSTEM_OPTIONS.filter((code) => SYSTEM_BRAND_STRUCTURE[code]);
  const getSubsystems = (system) =>
    system && SYSTEM_BRAND_STRUCTURE[system] ? Object.keys(SYSTEM_BRAND_STRUCTURE[system]) : [];
  const getSubsubsystems = (system, subsystem) =>
    system && subsystem && SYSTEM_BRAND_STRUCTURE[system]?.[subsystem]
      ? SYSTEM_BRAND_STRUCTURE[system][subsystem]
      : [];

  const getBrandOptionsForSystemPath = (category, system, subsystem, subsubsystem) => {
    const fullScoped = getBrandOptionsFromRegistry(brandRegistry, {
      category,
      system,
      subsystem,
      subsubsystem,
    });
    if (fullScoped.length) return fullScoped;
    if (normalizeText(category)) return getBrandOptionsFromRegistry(brandRegistry, { category });
    return getBrandOptionsFromRegistry(brandRegistry, {});
  };

  const handleSystemBrandChange = (index, key, value) => {
    setSystemBrandEntries((prev) =>
      prev.map((entry, idx) => {
        if (idx !== index) return entry;
        if (key === "system") return { ...entry, system: value, subsystem: "", subsubsystem: "" };
        if (key === "category") return { ...entry, category: value, system: "", subsystem: "", subsubsystem: "" };
        if (key === "subsystem") return { ...entry, subsystem: value, subsubsystem: "" };
        return { ...entry, [key]: value };
      }),
    );
  };

  const handleSystemBrandImage = (index, file) => {
    if (!file || !file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please select a valid image file", variant: "destructive" });
      return;
    }
    setSystemBrandEntries((prev) =>
      prev.map((entry, idx) => {
        if (idx !== index) return entry;
        if (entry.brandImagePreview?.startsWith("blob:")) URL.revokeObjectURL(entry.brandImagePreview);
        return {
          ...entry,
          brandImageFile: file,
          brandImagePreview: URL.createObjectURL(file),
        };
      }),
    );
  };

  const handleImageSelect = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please select a valid image file", variant: "destructive" });
      return;
    }
    if (buildingImagePreview?.startsWith("blob:")) URL.revokeObjectURL(buildingImagePreview);
    setBuildingImageFile(file);
    setBuildingImagePreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    const cleanBuildingName = normalizeBuildingName(buildingName);
    if (!cleanBuildingName || !form) return;
    if (!normalizeText(form.jobType) || !normalizeText(form.job)) {
      toast({ title: "Error", description: "Job type and job are required.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      let buildingImageUrl = form.existingBuildingImage || "";
      if (buildingImageFile) {
        const ext = buildingImageFile.name.split(".").pop() || "jpg";
        const storageRef = ref(storage, `buildings/${cleanBuildingName}/buildingImage.${ext}`);
        await uploadBytes(storageRef, buildingImageFile);
        buildingImageUrl = await getDownloadURL(storageRef);
      }

      const persistedSystemBrands = [];
      const validSystemBrands = systemBrandEntries.filter((entry) => normalizeText(entry.brandName));
      for (let index = 0; index < validSystemBrands.length; index += 1) {
        const entry = validSystemBrands[index];
        let brandImageUrl = entry.brandImagePreview?.startsWith("http") ? entry.brandImagePreview : "";
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

      const payload = buildBuildingDetailsPayload({
        form,
        persistedSystemBrands,
        buildingImageUrl,
      });

      const detailsRef = doc(db, `${cleanBuildingName}BuildingDB`, "buildingDetails");
      await setDoc(detailsRef, payload, { merge: true });
      toast({ title: "Success", description: "Building details updated successfully." });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error("Save building details:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save building details.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const jobOptions =
    form?.jobType === "Project"
      ? PROJECT_JOBS
      : form?.jobType === "Vision365 Plan"
        ? VISION365_PLAN_JOBS
        : SERVICE_JOBS;

  const selectedFmCompany = fmCompanies.find((c) => c.id === form?.selectedFmCompanyId);
  const operationsTeam = Array.isArray(selectedFmCompany?.teams?.operationsTeam)
    ? selectedFmCompany.teams.operationsTeam
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Edit Full Building Details</DialogTitle>
          <DialogDescription>
            Update building details for <strong>{buildingName || "—"}</strong>.
          </DialogDescription>
        </DialogHeader>

        {loading || !form ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">Loading building details...</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-buildingName">Building Name</Label>
                <Input id="edit-buildingName" value={form.buildingName} readOnly className="mt-2 bg-muted/50" />
              </div>
              {isConsultant && form.enquiryId ? (
                <div>
                  <Label htmlFor="edit-enquiryId">Enquiry ID</Label>
                  <Input id="edit-enquiryId" value={form.enquiryId} readOnly className="mt-2 bg-muted/50" />
                </div>
              ) : null}
              <div>
                <Label htmlFor="edit-buildingStatus">Building Status</Label>
                <select
                  id="edit-buildingStatus"
                  value={form.buildingStatus}
                  onChange={(e) => patchForm({ buildingStatus: e.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {BUILDING_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="edit-floorDetails">Floor Details</Label>
                <Input
                  id="edit-floorDetails"
                  value={form.floorDetails}
                  onChange={(e) => patchForm({ floorDetails: e.target.value })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="edit-location">Location</Label>
                <Input
                  id="edit-location"
                  value={form.location}
                  onChange={(e) => patchForm({ location: e.target.value })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="edit-plotNumber">Plot Number (location data)</Label>
                <Input
                  id="edit-plotNumber"
                  value={form.plotNumber}
                  onChange={(e) => patchForm({ plotNumber: e.target.value })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="edit-mapData">Map Data</Label>
                <Input
                  id="edit-mapData"
                  value={form.mapData}
                  onChange={(e) => patchForm({ mapData: e.target.value })}
                  className="mt-2"
                  placeholder="Lat/Lng notes or map details"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="edit-jobType">Job type</Label>
                  <select
                    id="edit-jobType"
                    value={form.jobType}
                    onChange={(e) => patchForm({ jobType: e.target.value, job: "" })}
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
                  <Label htmlFor="edit-job">Job</Label>
                  <select
                    id="edit-job"
                    value={form.job}
                    onChange={(e) => patchForm({ job: e.target.value })}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select job</option>
                    {jobOptions.map((j) => (
                      <option key={j} value={j}>
                        {j}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="edit-fireAlarmBrand">Fire Alarm Brand (legacy)</Label>
                  <Input
                    id="edit-fireAlarmBrand"
                    value={form.fireAlarmBrand}
                    onChange={(e) => patchForm({ fireAlarmBrand: e.target.value })}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-fireFightingBrand">Fire Fighting Brand (legacy)</Label>
                  <Input
                    id="edit-fireFightingBrand"
                    value={form.fireFightingBrand}
                    onChange={(e) => patchForm({ fireFightingBrand: e.target.value })}
                    className="mt-2"
                  />
                </div>
              </div>

              {form.jobType === "Services" ? (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="edit-fmCompany">FM Company</Label>
                      <select
                        id="edit-fmCompany"
                        value={form.selectedFmCompanyId}
                        onChange={(e) => {
                          const selectedId = e.target.value;
                          const selectedCompany = fmCompanies.find((item) => item.id === selectedId);
                          if (selectedCompany) {
                            applyFmCompanyToForm(selectedCompany);
                          } else {
                            patchForm({
                              selectedFmCompanyId: "",
                              fmCompany: "",
                              flsOperator: "",
                              selectedFlsOperatorIdx: "",
                              fmCompanyContactDetails: createContactDetails(),
                              operatorDetails: createContactDetails(),
                            });
                          }
                        }}
                        className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                      <Label htmlFor="edit-flsOperator">FLS Operator</Label>
                      <select
                        id="edit-flsOperator"
                        value={form.selectedFlsOperatorIdx}
                        onChange={(e) => {
                          const selectedIdx = e.target.value;
                          const matchedOperator =
                            selectedIdx === "" ? null : operationsTeam[Number(selectedIdx)];
                          if (matchedOperator) {
                            const { name, designation, email, phone } = extractOperatorDetail(matchedOperator);
                            patchForm({
                              selectedFlsOperatorIdx: selectedIdx,
                              flsOperator: name,
                              operatorDetails: {
                                name,
                                designation,
                                email,
                                phoneNumbers: phone ? [phone] : [""],
                              },
                            });
                          } else {
                            patchForm({
                              selectedFlsOperatorIdx: "",
                              flsOperator: "",
                              operatorDetails: createContactDetails(),
                            });
                          }
                        }}
                        className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        disabled={!form.selectedFmCompanyId}
                      >
                        <option value="">Select FLS Operator</option>
                        {operationsTeam.map((member, idx) => {
                          const operatorName = normalizeText(member?.name);
                          const operatorPhone = normalizeText(member?.contact || member?.contactNumber);
                          return (
                            <option key={`operator-${idx}`} value={String(idx)}>
                              {operatorName || `Operator ${idx + 1}`}
                              {operatorPhone ? ` - ${operatorPhone}` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="edit-firstPpmDate">First PPM Date</Label>
                      <Input
                        id="edit-firstPpmDate"
                        type="date"
                        value={form.firstPpmDate}
                        onChange={(e) => patchForm({ firstPpmDate: e.target.value })}
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-lastPpmDate">Last PPM Date</Label>
                      <Input
                        id="edit-lastPpmDate"
                        type="date"
                        value={form.lastPpmDate}
                        onChange={(e) => patchForm({ lastPpmDate: e.target.value })}
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <ContactDetailsBlock
                    title="FM COMPANY"
                    contact={form.fmCompanyContactDetails}
                    onChange={(c) => patchForm({ fmCompanyContactDetails: c })}
                    wrapperClassName="mt-2"
                  />
                  <ContactDetailsBlock
                    title="FLS OPERATORS"
                    contact={form.operatorDetails}
                    onChange={(c) => patchForm({ operatorDetails: c })}
                  />
                </>
              ) : null}

              {form.jobType === "Project" ? (
                <>
                  <ProjectContractorBlock
                    roleTitle="FIT OUT CONTRACTOR"
                    companyType="FIT OUT CONTRACTOR"
                    companySelectId="edit-fit-out"
                    fmCompanies={fmCompanies}
                    companyId={contractorCompanyIds.fitOut}
                    onCompanyIdChange={(id) => setContractorCompanyIds((p) => ({ ...p, fitOut: id }))}
                    contact={form.fitOutCompanyContactDetails}
                    onContactChange={(c) => patchForm({ fitOutCompanyContactDetails: c })}
                    wrapperClassName="mt-2"
                  />
                  <ProjectContractorBlock
                    roleTitle="MAIN CONTRACTOR"
                    companyType="MAIN CONTRACTOR"
                    companySelectId="edit-main"
                    fmCompanies={fmCompanies}
                    companyId={contractorCompanyIds.main}
                    onCompanyIdChange={(id) => setContractorCompanyIds((p) => ({ ...p, main: id }))}
                    contact={form.mainContractorCompanyContactDetails}
                    onContactChange={(c) => patchForm({ mainContractorCompanyContactDetails: c })}
                  />
                  <ProjectContractorBlock
                    roleTitle="MEP CONTRACTOR"
                    companyType="MEP CONTRACTOR"
                    companySelectId="edit-mep"
                    fmCompanies={fmCompanies}
                    companyId={contractorCompanyIds.mep}
                    onCompanyIdChange={(id) => setContractorCompanyIds((p) => ({ ...p, mep: id }))}
                    contact={form.mepContractorCompanyContactDetails}
                    onContactChange={(c) => patchForm({ mepContractorCompanyContactDetails: c })}
                  />
                  <ProjectContractorBlock
                    roleTitle="CONSULTANT"
                    companyType="CONSULTANT"
                    companySelectId="edit-consultant"
                    fmCompanies={fmCompanies}
                    companyId={contractorCompanyIds.consultant}
                    onCompanyIdChange={(id) => setContractorCompanyIds((p) => ({ ...p, consultant: id }))}
                    contact={form.consultantCompanyContactDetails}
                    onContactChange={(c) => patchForm({ consultantCompanyContactDetails: c })}
                  />
                </>
              ) : null}

              <div className="rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">System Brand Mapping</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSystemBrandEntries((p) => [...p, createSystemBrandEntry()])}
                  >
                    Add Row
                  </Button>
                </div>
                {systemBrandEntries.map((entry, index) => (
                  <div key={`edit-brand-${index}`} className="mt-4 rounded border p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                            handleSystemBrandChange(index, "brandName", value === "__custom__" ? "" : value);
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleSystemBrandImage(index, e.target.files?.[0])}
                      />
                    </div>
                    {entry.brandImagePreview ? (
                      <img
                        src={entry.brandImagePreview}
                        alt="Brand preview"
                        className="mt-3 h-20 w-28 rounded border object-cover"
                      />
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() =>
                        setSystemBrandEntries((prev) => {
                          if (prev.length === 1) return prev;
                          const target = prev[index];
                          if (target?.brandImagePreview?.startsWith("blob:")) {
                            URL.revokeObjectURL(target.brandImagePreview);
                          }
                          return prev.filter((_, idx) => idx !== index);
                        })
                      }
                    >
                      Remove Row
                    </Button>
                  </div>
                ))}
              </div>

              <div>
                <Label>Building Image</Label>
                <div
                  className="mt-2 cursor-pointer rounded-lg border-2 border-dashed border-muted-foreground/30 p-4 text-center transition-colors hover:border-primary/50 hover:bg-muted/20"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <p className="text-sm text-muted-foreground">
                    {buildingImageFile ? buildingImageFile.name : "Click to replace image (optional)"}
                  </p>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImageSelect(e.target.files?.[0])}
                />
                {buildingImagePreview ? (
                  <img
                    src={buildingImagePreview}
                    alt="Building preview"
                    className="mt-3 h-24 w-36 rounded border object-cover"
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || loading || !form}>
            {saving ? "Saving..." : "Save Details"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
