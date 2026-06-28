/** Fresh-install database — admin login only, no communities/buildings/assets/floor plans */

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

export function getDefaultDbSeed(): Record<string, unknown> {
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

function isBuildingDbKey(key: string): boolean {
  return key.endsWith("BuildingDB");
}

/** Strip sample/building data — keep admin login only */
export function sanitizeDbSeed(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const seed = getDefaultDbSeed();
  if (!raw || typeof raw !== "object") return seed;

  const userDb = raw.UserDB as Record<string, Record<string, unknown>> | undefined;
  if (userDb && typeof userDb === "object") {
    seed.UserDB = {};
    for (const [id, user] of Object.entries(userDb)) {
      if (!user || typeof user !== "object") continue;
      (seed.UserDB as Record<string, unknown>)[id] = {
        email: user.email || ADMIN_DEFAULTS.email,
        password: user.password || ADMIN_DEFAULTS.password,
        role: user.role || ADMIN_DEFAULTS.role,
        designation: user.designation || ADMIN_DEFAULTS.designation,
        communities: [],
        buildings: {},
      };
    }
  }

  const seedUserDb = seed.UserDB as Record<string, unknown>;
  if (!seedUserDb.admin) {
    seedUserDb.admin = {
      ...ADMIN_DEFAULTS,
      communities: [],
      buildings: {},
    };
  }
  if (!seedUserDb.client) {
    seedUserDb.client = {
      ...CLIENT_DEFAULTS,
      communities: [],
      buildings: {},
    };
  }

  const dropped = Object.keys(raw).filter(isBuildingDbKey);
  if (dropped.length > 0) {
    console.log(`[seed] Ignored building data keys: ${dropped.join(", ")}`);
  }

  return seed;
}
