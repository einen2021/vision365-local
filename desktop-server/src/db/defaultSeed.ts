/**
 * Default / seed helpers for the local document DB.
 *
 * IMPORTANT: Runtime seeding must NEVER strip communities, buildings, assets,
 * or building DB docs. Stripping is only for optional package builds.
 */

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

/** Ensure admin/client login users exist without touching communities/buildings/assets. */
function ensureLoginUsers(userDb: Record<string, unknown>): Record<string, unknown> {
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
 * Preserves communities, AssetsList, *BuildingDB docs, and user building assignments.
 */
export function prepareDbSeed(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return getDefaultDbSeed();
  }

  const seed: Record<string, unknown> = { ...raw };
  const userDb =
    seed.UserDB && typeof seed.UserDB === "object"
      ? (seed.UserDB as Record<string, unknown>)
      : {};
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
 * @deprecated Use prepareDbSeed — runtime seed must not strip data.
 * Kept as an alias so older imports do not wipe communities/assets.
 */
export function sanitizeDbSeed(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return prepareDbSeed(raw);
}

/**
 * Package-build only: strip sample content down to login users.
 * Do NOT call this from desktop-server runtime seed.
 */
export function stripSeedToLoginOnly(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
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
        // Keep assigned communities/buildings when present on the user record.
        communities: Array.isArray(user.communities) ? user.communities : [],
        buildings:
          user.buildings && typeof user.buildings === "object" ? user.buildings : {},
      };
    }
  }

  seed.UserDB = ensureLoginUsers(seed.UserDB as Record<string, unknown>);
  return seed;
}
