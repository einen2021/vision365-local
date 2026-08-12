import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { readDb, writeDb, isDocumentsEmpty } from "./documentStore";
import { findUserByEmail, upsertUser } from "./repos";
import { getDefaultDbSeed, prepareDbSeed } from "./defaultSeed";
import {
  countProductiveData,
  isDbEssentiallyEmpty,
  maybeLoadRestoreSnapshot,
  saveDbSnapshotBackup,
} from "../services/dbSnapshotBackup";
import { importLegacyAppDataAssets } from "../services/storageService";

const BCRYPT_ROUNDS = 12;

/**
 * Seed only when the SQLite documents table is empty.
 * Prefer restoring from AppData JSON backups before writing defaults.
 */
export async function seedIfEmpty(appDataPath: string) {
  // Always pull floor-plans / uploads / snapshot JSON from Roaming+Local
  // com.vision365-desktop (and other known folders) before seeding.
  importLegacyAppDataAssets(appDataPath);

  if (!isDocumentsEmpty()) {
    await restoreFromBackupIfEmpty(appDataPath);
    await ensureDefaultUsers();
    return;
  }

  // Brand-new install: try JSON backup before writing a seed file.
  const restored = await restoreFromBackupIfEmpty(appDataPath, { force: true });
  if (restored) {
    // After DB import, copy any remaining media that appeared under other roots.
    importLegacyAppDataAssets(appDataPath);
    await ensureDefaultUsers();
    return;
  }

  const seedPaths = [
    process.env.VISION365_SEED_PATH,
    path.resolve(process.cwd(), "data/db.json"),
  ].filter((p): p is string => Boolean(p));

  let rawSeed: Record<string, unknown> = {};
  for (const seedPath of seedPaths) {
    if (fs.existsSync(seedPath)) {
      rawSeed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      console.log(`[seed] Loaded seed file from ${seedPath}`);
      break;
    }
  }

  const seedData =
    Object.keys(rawSeed).length > 0
      ? prepareDbSeed(rawSeed)
      : getDefaultDbSeed();

  const stats = countProductiveData(seedData);
  if (Object.keys(rawSeed).length === 0) {
    console.log("[seed] Using built-in default seed (admin only, empty data)");
  } else {
    console.log(
      `[seed] Importing seed with all data preserved ` +
        `(communities=${stats.communities}, assets=${stats.assets}, buildingDBs=${stats.buildingDbs})`,
    );
  }

  writeDb(seedData);
  if (!isDbEssentiallyEmpty(seedData)) {
    saveDbSnapshotBackup(seedData, appDataPath);
  }
  await ensureDefaultUsers();
  console.log("[seed] Database seeded successfully");
}

/** If live DB has no communities/assets, restore from the latest JSON snapshot. */
export async function restoreFromBackupIfEmpty(
  appDataPath: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const live = readDb();
  if (!options.force && !isDbEssentiallyEmpty(live)) {
    try {
      saveDbSnapshotBackup(live, appDataPath);
    } catch {
      // ignore
    }
    return false;
  }

  const candidate = maybeLoadRestoreSnapshot(live, appDataPath);
  if (!candidate) {
    if (isDbEssentiallyEmpty(live)) {
      console.warn(
        "[seed] Database is empty and no JSON snapshot backup was found. " +
          "Checked Roaming + Local: com.vision365-desktop, com.vision365.desktop, Vision365.",
      );
    }
    return false;
  }

  const stats = countProductiveData(candidate.data);
  console.log(
    `[seed] Restoring empty DB from backup ${candidate.path} ` +
      `(communities=${stats.communities}, assets=${stats.assets}, buildingDBs=${stats.buildingDbs})`,
  );

  const merged: Record<string, unknown> = {
    ...candidate.data,
  };
  if (live.UserDB && typeof live.UserDB === "object") {
    merged.UserDB = live.UserDB;
  }
  if (live.firePanelState) {
    merged.firePanelState = live.firePanelState;
  }

  writeDb(merged);
  saveDbSnapshotBackup(merged, appDataPath);

  // Copy floor-plans / uploads / settings from the AppData folder that
  // owned the snapshot (and every other known root) into the active install.
  const media = importLegacyAppDataAssets(appDataPath);
  console.log(
    `[seed] Backup restore complete — SQLite imported; ` +
      `floorPlans=+${media.floorPlans}, uploads=+${media.uploads}, snapshots=+${media.snapshots}`,
  );
  return true;
}

/** Ensure built-in users exist — never clear communities/buildings on existing users. */
async function ensureDefaultUsers() {
  const defaults = getDefaultDbSeed();
  type SeedUser = {
    email?: string;
    password?: string;
    role?: string;
    designation?: string;
    communities?: unknown[];
    buildings?: Record<string, unknown>;
  };

  const defaultUserDb = (defaults.UserDB || {}) as Record<string, SeedUser>;

  const db = readDb();
  const userDb = { ...((db.UserDB || {}) as Record<string, SeedUser>) };
  let changed = false;

  for (const [id, user] of Object.entries(defaultUserDb)) {
    if (!userDb[id]) {
      userDb[id] = {
        ...user,
        communities: Array.isArray(user.communities) ? user.communities : [],
        buildings:
          user.buildings && typeof user.buildings === "object"
            ? user.buildings
            : {},
      };
      changed = true;
    }
  }

  if (changed) {
    writeDb({ ...db, UserDB: userDb });
    console.log("[seed] Added missing default users to UserDB");
  }

  await migrateUsersToBcrypt();
}

async function migrateUsersToBcrypt() {
  const db = readDb();
  const userDb = (db.UserDB || {}) as Record<
    string,
    { email?: string; password?: string; role?: string; designation?: string }
  >;

  for (const [id, user] of Object.entries(userDb)) {
    if (!user.email) continue;

    const existing = findUserByEmail(user.email);
    if (existing) continue;

    const password = user.password || "admin123";
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date().toISOString();

    upsertUser({
      id,
      email: user.email,
      password_hash: hash,
      role: user.role || "admin",
      designation: user.designation || "",
      created_at: now,
      updated_at: now,
    });
  }
}
