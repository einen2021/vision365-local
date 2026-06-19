import { getCollection } from "./client";

/** Create MongoDB indexes for app collections */
export async function runMigrations(): Promise<void> {
  const users = getCollection("users");
  await users.createIndex({ email: 1 }, { unique: true });

  const sessions = getCollection("sessions");
  await sessions.createIndex({ token: 1 });
  await sessions.createIndex({ expires_at: 1 });

  const files = getCollection("files");
  await files.createIndex({ category: 1 });
  await files.createIndex({ relative_path: 1 });

  const settings = getCollection("settings");
  await settings.createIndex({ key: 1 }, { unique: true });

  console.log("[migrate] MongoDB indexes ready");
}
