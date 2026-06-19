import { Hono } from "hono";
import { readDb, writeDb } from "../db/documentStore";
import {
  getBuildingDbKeys,
  toShortName,
  listUnassignedBuildings,
  listAllBuildingsWithStatus,
  getCommunityBuildingsList,
  assignBuildingsToCommunity,
  removeBuildingsFromCommunity,
} from "../lib/communityBuildings";

/** Building and community REST routes — mirrors Next.js API routes */
export function createBuildingsRoutes() {
  const app = new Hono();

  app.post("/building/all", async (c) => {
    const db = await readDb();
    const keys = getBuildingDbKeys(db);
    return c.json({ buildings: keys.map((k) => ({ name: toShortName(k), dbKey: k })) });
  });

  app.get("/admin/get-mails", async (c) => {
    const db = await readDb();
    const userDb = (db.UserDB || {}) as Record<string, { email?: string; role?: string }>;
    const users = Object.entries(userDb).map(([id, u]) => ({
      id,
      email: u.email,
      role: u.role,
    }));
    return c.json({ users });
  });

  app.get("/buildings/unassigned", async (c) => {
    const db = await readDb();
    return c.json({ buildings: listUnassignedBuildings(db) });
  });

  app.post("/buildings/with-community-status", async (c) => {
    const db = await readDb();
    return c.json({ buildings: listAllBuildingsWithStatus(db) });
  });

  app.get("/community/:communityId/buildings", async (c) => {
    const communityId = c.req.param("communityId");
    const db = await readDb();
    return c.json({ buildings: getCommunityBuildingsList(db, communityId) });
  });

  app.post("/community/:communityId/assign-buildings", async (c) => {
    const communityId = c.req.param("communityId");
    const body = await c.req.json();
    const db = await readDb();
    const result = assignBuildingsToCommunity(
      db,
      communityId,
      body.buildings || [],
      body.updatedBy
    );
    if (result.status) await writeDb(db);
    return c.json(result);
  });

  app.post("/community/:communityId/remove-buildings", async (c) => {
    const communityId = c.req.param("communityId");
    const body = await c.req.json();
    const db = await readDb();
    const result = removeBuildingsFromCommunity(
      db,
      communityId,
      body.buildings || [],
      body.updatedBy
    );
    if (result.status) await writeDb(db);
    return c.json(result);
  });

  return app;
}
