/**
 * CLI: run SQLite migrations against AppData database.
 */
import { resolveAppDataPath, initAppDirectories } from "../services/storageService";
import { connectSqlite, closeDatabase } from "./client";
import { runMigrations } from "./migrate";

function main() {
  const appData = resolveAppDataPath();
  const paths = initAppDirectories(appData);
  connectSqlite(paths.database);
  runMigrations();
  closeDatabase();
  console.log("[migrate-cli] Done");
}

main();
