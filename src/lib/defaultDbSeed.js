/** Fresh-install database — admin login only, no communities/buildings/assets/floor plans */

const ADMIN_DEFAULTS = {
  email: "admin@vision365.com",
  password: "admin123",
  role: "admin",
  designation: "Administrator",
};

export function getDefaultDbSeed() {
  return {
    UserDB: {
      admin: {
        ...ADMIN_DEFAULTS,
        communities: [],
        buildings: {},
      },
    },
    communities: {},
    AssetsList: {},
    BrandRegistry: {},
    Staffs: {},
    jobs: {},
  };
}

function isBuildingDbKey(key) {
  return typeof key === "string" && key.endsWith("BuildingDB");
}

/**
 * Strip communities, buildings, assets, and floor-plan data from a seed file.
 * Only admin credentials are kept so first install starts empty.
 */
export function sanitizeDbSeed(raw) {
  const seed = getDefaultDbSeed();
  if (!raw || typeof raw !== "object") return seed;

  const userDb = raw.UserDB;
  if (userDb && typeof userDb === "object") {
    seed.UserDB = {};
    for (const [id, user] of Object.entries(userDb)) {
      if (!user || typeof user !== "object") continue;
      seed.UserDB[id] = {
        email: user.email || ADMIN_DEFAULTS.email,
        password: user.password || ADMIN_DEFAULTS.password,
        role: user.role || ADMIN_DEFAULTS.role,
        designation: user.designation || ADMIN_DEFAULTS.designation,
        communities: [],
        buildings: {},
      };
    }
  }

  if (!seed.UserDB.admin) {
    seed.UserDB.admin = {
      ...ADMIN_DEFAULTS,
      communities: [],
      buildings: {},
    };
  }

  // Drop any *BuildingDB root docs (buildings, floor maps, assets, alarms, etc.)
  const dropped = Object.keys(raw).filter(isBuildingDbKey);
  if (dropped.length > 0) {
    console.log(`[seed] Ignored building data keys: ${dropped.join(", ")}`);
  }

  return seed;
}
