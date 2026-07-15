/** Default / seed helpers — runtime must never strip communities/buildings/assets. */

const ADMIN_DEFAULTS = {
  email: "admin@vision365.com",
  password: "admin123",
  role: "admin",
  designation: "Administrator",
};

const CLIENT_DEFAULTS = {
  email: "client@vision365.com",
  password: "Client123",
  role: "client",
  designation: "Client",
};

export function getDefaultDbSeed() {
  return {
    UserDB: {
      admin: {
        ...ADMIN_DEFAULTS,
        communities: [],
        buildings: {},
      },
      client: {
        ...CLIENT_DEFAULTS,
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

function ensureLoginUsers(userDb) {
  const next = { ...userDb };
  if (!next.admin || typeof next.admin !== "object") {
    next.admin = {
      ...ADMIN_DEFAULTS,
      communities: [],
      buildings: {},
    };
  }
  if (!next.client || typeof next.client !== "object") {
    next.client = {
      ...CLIENT_DEFAULTS,
      communities: [],
      buildings: {},
    };
  }
  return next;
}

/**
 * Prepare seed data for first install / import.
 * Preserves communities, AssetsList, *BuildingDB docs, and user assignments.
 */
export function prepareDbSeed(raw) {
  if (!raw || typeof raw !== "object") {
    return getDefaultDbSeed();
  }

  const seed = { ...raw };
  const userDb =
    seed.UserDB && typeof seed.UserDB === "object" ? seed.UserDB : {};
  seed.UserDB = ensureLoginUsers(userDb);

  if (!seed.communities || typeof seed.communities !== "object") {
    seed.communities = {};
  }
  if (!seed.AssetsList || typeof seed.AssetsList !== "object") {
    seed.AssetsList = {};
  }

  return seed;
}

/**
 * @deprecated Use prepareDbSeed — does not strip data anymore.
 */
export function sanitizeDbSeed(raw) {
  return prepareDbSeed(raw);
}

/**
 * Package-build only helper (optional). Prefer prepareDbSeed at runtime.
 */
export function stripSeedToLoginOnly(raw) {
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
        communities: Array.isArray(user.communities) ? user.communities : [],
        buildings:
          user.buildings && typeof user.buildings === "object"
            ? user.buildings
            : {},
      };
    }
  }

  seed.UserDB = ensureLoginUsers(seed.UserDB);
  return seed;
}
