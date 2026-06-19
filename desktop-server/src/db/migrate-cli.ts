import path from "path";
import { connectMongo, closeDatabase } from "./client";
import { startEmbeddedMongo, stopEmbeddedMongo } from "./embeddedMongo";
import { runMigrations } from "./migrate";

async function main() {
  const appData = process.env.VISION365_APP_DATA || path.join(process.cwd(), ".vision365-dev");
  const mongoData = path.join(appData, "database", "mongodb");
  const uri = await startEmbeddedMongo(mongoData);
  await connectMongo(uri);
  await runMigrations();
  await closeDatabase();
  await stopEmbeddedMongo();
  console.log("[migrate] Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
