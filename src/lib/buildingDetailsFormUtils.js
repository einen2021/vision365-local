import { Timestamp, deleteField } from "firebase/firestore";

export const createContactDetails = () => ({
  name: "",
  designation: "",
  email: "",
  phoneNumbers: [""],
});

export const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

export const getTimestampAtNoon = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(12, 0, 0, 0);
  return Timestamp.fromDate(date);
};

export const firestoreTimestampToDateInput = (value) => {
  if (!value) return "";
  let date;
  if (typeof value === "object" && value.seconds != null) {
    date = new Date(Number(value.seconds) * 1000);
  } else if (value instanceof Timestamp) {
    date = value.toDate();
  } else if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

export const sanitizeContactDetails = (contact) => ({
  name: normalizeText(contact.name),
  designation: normalizeText(contact.designation),
  email: normalizeText(contact.email),
  phoneNumbers: (contact.phoneNumbers || []).map(normalizeText).filter(Boolean),
});

export const parseContactFromFirestore = (raw) => {
  if (!raw || typeof raw !== "object") return createContactDetails();
  const phones = raw.phoneNumbers ?? raw.phones ?? raw.phone;
  let phoneNumbers = [""];
  if (Array.isArray(phones)) {
    phoneNumbers = phones.filter(Boolean).length ? phones.map((p) => String(p)) : [""];
  } else if (phones) {
    phoneNumbers = [String(phones)];
  }
  return {
    name: normalizeText(raw.name),
    designation: normalizeText(raw.designation),
    email: normalizeText(raw.email || raw.emailId),
    phoneNumbers,
  };
};

export const extractOperatorDetail = (operator) => {
  const name = normalizeText(operator?.name);
  const designation = normalizeText(operator?.designation);
  const email = normalizeText(operator?.email || operator?.emailId);
  const phone = normalizeText(
    operator?.contact || operator?.contactNumber || operator?.phone || operator?.mobile,
  );
  return { name, designation, email, phone };
};

export const findFmCompanyIdByName = (fmCompanies, name) => {
  const n = normalizeText(name);
  if (!n) return "";
  const match = (fmCompanies || []).find((c) => normalizeText(c?.companyName) === n);
  return match?.id || "";
};

export const findOperatorIndex = (company, operatorName) => {
  const n = normalizeText(operatorName);
  if (!n || !company) return "";
  const team = Array.isArray(company?.teams?.operationsTeam) ? company.teams.operationsTeam : [];
  const idx = team.findIndex((m) => normalizeText(m?.name) === n);
  return idx >= 0 ? String(idx) : "";
};

export const systemBrandsFromDetails = (systemBrands) => {
  const createEntry = () => ({
    category: "",
    system: "",
    subsystem: "",
    subsubsystem: "",
    brandName: "",
    brandImageFile: null,
    brandImagePreview: "",
  });
  if (!Array.isArray(systemBrands) || systemBrands.length === 0) {
    return [createEntry()];
  }
  return systemBrands.map((row) => ({
    category: normalizeText(row?.category),
    system: normalizeText(row?.system),
    subsystem: normalizeText(row?.subsystem),
    subsubsystem: normalizeText(row?.subsubsystem),
    brandName: normalizeText(row?.brandName),
    brandImageFile: null,
    brandImagePreview: normalizeText(row?.brandImageUrl) || "",
  }));
};

export const buildBuildingDetailsPayload = ({
  form,
  persistedSystemBrands,
  buildingImageUrl,
}) => {
  const emptyContact = sanitizeContactDetails(createContactDetails());
  const isProject = normalizeText(form.jobType) === "Project";
  const isServices = normalizeText(form.jobType) === "Services";

  const payload = {
    buildingName: normalizeText(form.buildingName),
    floorDetails: normalizeText(form.floorDetails),
    location: normalizeText(form.location),
    buildingStatus: normalizeText(form.buildingStatus) || "construction",
    locationData: normalizeText(form.plotNumber),
    mapData: normalizeText(form.mapData),
    jobType: normalizeText(form.jobType),
    job: normalizeText(form.job),
    system: {
      fireAlarmBrand: normalizeText(form.fireAlarmBrand),
      fireFightingBrand: normalizeText(form.fireFightingBrand),
    },
    systemBrands: persistedSystemBrands,
    buildingImage: buildingImageUrl || "",
    updatedAt: new Date(),
  };

  if (isProject) {
    Object.assign(payload, {
      fitOutCompanyContactDetails: sanitizeContactDetails(form.fitOutCompanyContactDetails),
      mainContractorCompanyContactDetails: sanitizeContactDetails(form.mainContractorCompanyContactDetails),
      mepContractorCompanyContactDetails: sanitizeContactDetails(form.mepContractorCompanyContactDetails),
      consultantCompanyContactDetails: sanitizeContactDetails(form.consultantCompanyContactDetails),
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
      firstPpmDate: deleteField(),
      lastPPMDate: deleteField(),
    });
  } else if (isServices) {
    Object.assign(payload, {
      fmCompany: normalizeText(form.fmCompany),
      flsOperator: normalizeText(form.flsOperator),
      operator: normalizeText(form.flsOperator),
      fmCompanyContactDetails: sanitizeContactDetails(form.fmCompanyContactDetails),
      operatorDetails: sanitizeContactDetails(form.operatorDetails),
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
      firstPpmDate: getTimestampAtNoon(form.firstPpmDate),
      lastPPMDate: getTimestampAtNoon(form.lastPpmDate),
    });
  } else {
    Object.assign(payload, {
      fmCompany: normalizeText(form.fmCompany),
      flsOperator: normalizeText(form.flsOperator),
      operator: normalizeText(form.flsOperator),
      fmCompanyContactDetails: sanitizeContactDetails(form.fmCompanyContactDetails),
      operatorDetails: sanitizeContactDetails(form.operatorDetails),
      fitOutCompanyContactDetails: emptyContact,
      mainContractorCompanyContactDetails: emptyContact,
      mepContractorCompanyContactDetails: emptyContact,
      consultantCompanyContactDetails: emptyContact,
      firstPpmDate: getTimestampAtNoon(form.firstPpmDate),
      lastPPMDate: getTimestampAtNoon(form.lastPpmDate),
    });
  }

  return payload;
};

export const detailsToEditForm = (details, buildingName, fmCompanies) => {
  const d = details || {};
  const jobType = normalizeText(d.jobType) || "Services";
  const fmCompanyName = normalizeText(d.fmCompany);
  const flsOperatorName = normalizeText(d.flsOperator || d.operator);
  const fmCompanyId = findFmCompanyIdByName(fmCompanies, fmCompanyName);
  const fmDoc = (fmCompanies || []).find((c) => c.id === fmCompanyId);

  return {
    buildingName: normalizeText(d.buildingName) || normalizeText(buildingName),
    enquiryId: normalizeText(d.enquiryId ?? d.enquiryID ?? d.enquiry_id),
    floorDetails: normalizeText(d.floorDetails),
    location: normalizeText(d.location),
    plotNumber: normalizeText(d.locationData),
    mapData: normalizeText(d.mapData),
    buildingStatus: normalizeText(d.buildingStatus) || "construction",
    jobType,
    job: normalizeText(d.job),
    fireAlarmBrand: normalizeText(d.system?.fireAlarmBrand),
    fireFightingBrand: normalizeText(d.system?.fireFightingBrand),
    fmCompany: fmCompanyName,
    selectedFmCompanyId: fmCompanyId,
    flsOperator: flsOperatorName,
    selectedFlsOperatorIdx: findOperatorIndex(fmDoc, flsOperatorName),
    firstPpmDate: firestoreTimestampToDateInput(d.firstPpmDate),
    lastPpmDate: firestoreTimestampToDateInput(d.lastPPMDate),
    fmCompanyContactDetails: parseContactFromFirestore(d.fmCompanyContactDetails),
    operatorDetails: parseContactFromFirestore(d.operatorDetails),
    fitOutCompanyContactDetails: parseContactFromFirestore(d.fitOutCompanyContactDetails),
    mainContractorCompanyContactDetails: parseContactFromFirestore(d.mainContractorCompanyContactDetails),
    mepContractorCompanyContactDetails: parseContactFromFirestore(d.mepContractorCompanyContactDetails),
    consultantCompanyContactDetails: parseContactFromFirestore(d.consultantCompanyContactDetails),
    existingBuildingImage: normalizeText(d.buildingImage),
  };
};
