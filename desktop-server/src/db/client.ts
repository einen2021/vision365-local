import { MongoClient, type Db, type Collection, type Document } from "mongodb";

const DB_NAME = "vision365";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(uri: string): Promise<Db> {
  if (db) return db;

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return db;
}

export function getCollection<T extends Document = Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
