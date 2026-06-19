import fs from "fs";
import path from "path";
import net from "net";
import { MongoClient } from "mongodb";
import { sanitizeDbSeed } from "./defaultDbSeed.js";

const DB_NAME = "vision365";
const MONGO_DATA_PATH = path.join(process.cwd(), "data", "mongodb");
const DEFAULT_PORT = 47820;

let client = null;
let db = null;
let memoryServer = null;
let connectPromise = null;

function isMongoPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1500);
  });
}

async function startEmbeddedMongo() {
  if (process.env.VISION365_MONGO_URI) {
    return process.env.VISION365_MONGO_URI;
  }

  const port = Number(process.env.VISION365_MONGO_PORT || DEFAULT_PORT);
  const existingUri = `mongodb://127.0.0.1:${port}`;

  // Reuse an already-running mongod (avoids mongod.lock conflicts)
  if (await isMongoPortOpen(port)) {
    return existingUri;
  }

  const { MongoMemoryServer } = await import("mongodb-memory-server");
  fs.mkdirSync(MONGO_DATA_PATH, { recursive: true });

  memoryServer = await MongoMemoryServer.create({
    instance: {
      dbPath: MONGO_DATA_PATH,
      port,
      ip: "127.0.0.1",
      storageEngine: "wiredTiger",
    },
  });

  return memoryServer.getUri();
}

export async function ensureMongo() {
  if (db) return db;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const uri = await startEmbeddedMongo();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(DB_NAME);
    await ensureIndexes();
    await seedIfEmpty();
    return db;
  })();

  return connectPromise;
}

export async function getCollection(name) {
  const database = await ensureMongo();
  return database.collection(name);
}

async function ensureIndexes() {
  const users = db.collection("users");
  await users.createIndex({ email: 1 }, { unique: true });

  const sessions = db.collection("sessions");
  await sessions.createIndex({ token: 1 });

  const files = db.collection("files");
  await files.createIndex({ relative_path: 1 });
}

async function seedIfEmpty() {
  const snapshot = db.collection("db_snapshot");
  const existing = await snapshot.findOne({ _id: 1 });
  if (existing) return;

  const seedPath = path.join(process.cwd(), "data", "db.json");
  let rawSeed = null;

  if (fs.existsSync(seedPath)) {
    rawSeed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    console.log("[mongo] Loaded seed file from data/db.json");
  }

  const seedData = sanitizeDbSeed(rawSeed);
  if (!rawSeed) {
    console.log("[mongo] Using built-in default seed (admin only, empty data)");
  } else {
    console.log("[mongo] Sanitized seed — communities, buildings, assets, and floor plans removed");
  }

  await snapshot.updateOne(
    { _id: 1 },
    { $set: { data: seedData, updated_at: new Date().toISOString() } },
    { upsert: true }
  );
}
