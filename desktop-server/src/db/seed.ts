import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { getCollection } from "./client";
import { readDb, writeDb } from "./documentStore";
import { sanitizeDbSeed } from "./defaultSeed";

const BCRYPT_ROUNDS = 12;

/** Seed database on first run — admin only, no communities/buildings/assets */
export async function seedIfEmpty(_appDataPath: string) {
  const snapshot = getCollection("db_snapshot");
  const existing = await snapshot.findOne({ _id: 1 });

  if (existing) {
    await migrateUsersToBcrypt();
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

  const seedData = sanitizeDbSeed(Object.keys(rawSeed).length > 0 ? rawSeed : null);
  if (Object.keys(rawSeed).length === 0) {
    console.log("[seed] Using built-in default seed (admin only, empty data)");
  } else {
    console.log("[seed] Sanitized seed — communities, buildings, assets, and floor plans removed");
  }

  await writeDb(seedData);
  await migrateUsersToBcrypt();
  console.log("[seed] Database seeded successfully");
}

/** Migrate plaintext passwords from UserDB to bcrypt users collection */
async function migrateUsersToBcrypt() {
  const users = getCollection("users");
  const db = await readDb();
  const userDb = (db.UserDB || {}) as Record<
    string,
    { email?: string; password?: string; role?: string; designation?: string }
  >;

  for (const [id, user] of Object.entries(userDb)) {
    if (!user.email) continue;

    const existing = await users.findOne({ email: user.email });
    if (existing) continue;

    const password = user.password || "admin123";
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date().toISOString();

    await users.insertOne({
      _id: id,
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
