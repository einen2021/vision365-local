export const JOB_TYPES = ["Project", "Services", "Vision365 Plan"];

export const PROJECT_JOBS = [
  "Material Supply Only",
  "Installation Only",
  "Supply & Installation",
  "Fit-out",
  "DCD Certification",
];

export const SERVICE_JOBS = [
  "Material Supply Only",
  "Site Survey",
  "AMC",
  "Service",
  "Callout",
  "Rectification",
  "One-time maintenance",
  "DCD Certification",
];

export const VISION365_PLAN_JOBS = [
  "Basic (only notification services)",
  "Single Building (1 panel)",
  "Single Property ( Network panel)",
  "Community (min 5 Buildings)",
];

export const BUILDING_STATUS_OPTIONS = [
  { value: "construction", label: "Construction" },
  { value: "handover", label: "Handover" },
  { value: "operation", label: "Operation" },
  { value: "Not set", label: "Not set" },
];

export const SYSTEM_OPTIONS = ["FA", "FF", "CBS", "CMS", "PAVE", "SCL"];

export const SYSTEM_LABELS = {
  FA: "Fire Alarm",
  FF: "Fire Fighting",
  CBS: "Central Battery System",
  CMS: "Central Monitoring System",
  PAVE: "Public Address / Voice Evacuation",
  SCL: "Smoke Control",
};

export const formatSystemOption = (code) => {
  const label = SYSTEM_LABELS[code];
  return label ? `${code} — ${label}` : code;
};

export const SYSTEM_BRAND_STRUCTURE = {
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

export const createSystemBrandEntry = () => ({
  category: "",
  system: "",
  subsystem: "",
  subsubsystem: "",
  brandName: "",
  brandImageFile: null,
  brandImagePreview: "",
});
