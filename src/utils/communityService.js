/**
 * communityService.js
 *
 * Loads communities from Firestore based on who is logged in and their role.
 *
 * Main function: getUserCommunities(email, role)
 *   - admin / coordinator → all communities
 *   - consultant / sales → communities assigned in UserDB
 *   - others → handled by assignedSalesContext (job teams)
 */

import { db } from "@/config/firebase";
import { normalizeBuildingName } from "@/lib/buildingNames";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  getDoc,
} from "firebase/firestore";
import { isConsultantLikeRole, normalizeRoleKey } from "@/lib/roleAccess";

// Turn Firestore timestamp into a normal date
function toDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate();
  return undefined;
}

// Get building names saved on a user document
export function extractUserBuildingNames(userData) {
  const names = new Set();
  const buildings = userData?.buildings;

  if (Array.isArray(buildings)) {
    buildings.forEach((b) => {
      const n = normalizeBuildingName(b);
      if (n) names.add(n);
    });
  } else if (buildings && typeof buildings === "object") {
    Object.values(buildings).forEach((val) => {
      const list = Array.isArray(val) ? val : [val];
      list.forEach((b) => {
        const n = normalizeBuildingName(b);
        if (n) names.add(n);
      });
    });
  }

  return [...names];
}

// Turn one Firestore community document into a simple object
function mapCommunityDoc(docSnap) {
  const data = docSnap.data();
  const buildings = (data.buildings || [])
    .map(normalizeBuildingName)
    .filter(Boolean);

  return {
    id: docSnap.id,
    communityName: String(data.communityName || data.name || ""),
    buildings,
    description: String(data.description || ""),
    totalBuildings: Number(data.totalBuildings || buildings.length || 0),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

// Load every community (used by admin and coordinator)
export async function loadAllCommunitiesFromFirestore() {
  const ref = collection(db, "communities");

  try {
    const q = query(ref, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(mapCommunityDoc);
  } catch (error) {
    // If orderBy fails (missing index), load without sorting
    const snap = await getDocs(ref);
    const list = snap.docs.map(mapCommunityDoc);
    list.sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return tb - ta;
    });
    return list;
  }
}

// Find the SALES community (used as fallback for consultants)
function findSalesCommunity(communities) {
  return communities.find((c) =>
    String(c.communityName || "").toLowerCase().includes("sales"),
  );
}

// Look up a user in UserDB by email (falls back to MailDB)
export async function fetchUserDocByEmail(email) {
  const trimmed = String(email || "").trim();
  if (!trimmed) return null;

  const emails = [trimmed, trimmed.toLowerCase()];
  for (const colName of ["UserDB", "MailDB"]) {
    for (const em of emails) {
      const q = query(collection(db, colName), where("email", "==", em));
      const snap = await getDocs(q);
      if (!snap.empty) return snap.docs[0];
    }
  }
  return null;
}

// If consultant has no assignments, give them the sales community
async function consultantFallbackCommunities() {
  const all = await loadAllCommunitiesFromFirestore();
  const sales = findSalesCommunity(all);
  if (sales) return [sales];
  return all.length > 0 ? [all[0]] : [];
}

// Build community list from UserDB assignments
async function buildCommunitiesForUser(userData) {
  const communityIds = userData.communities || [];
  const result = [];

  for (const communityId of communityIds) {
    const communityDoc = await getDoc(doc(db, "communities", communityId));
    if (!communityDoc.exists()) continue;

    const data = communityDoc.data();
    const userBuildings = (userData.buildings?.[communityId] || []).map(
      normalizeBuildingName,
    );

    let buildings = (data.buildings || []).map(normalizeBuildingName).filter(Boolean);

    if (userBuildings.length > 0) {
      buildings = buildings.filter((b) =>
        userBuildings.some(
          (id) =>
            id === b ||
            id === `${b}BuildingDB` ||
            b === `${id}BuildingDB`,
        ),
      );
    }

    result.push({
      id: communityDoc.id,
      communityName: String(data.communityName || ""),
      buildings,
      description: String(data.description || ""),
      totalBuildings: buildings.length,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    });
  }

  // Also match standalone building names to communities
  const standalone = extractUserBuildingNames(userData);
  if (standalone.length > 0) {
    const all = await loadAllCommunitiesFromFirestore();
    const seen = new Set(result.map((c) => c.id));

    for (const community of all) {
      const matched = (community.buildings || []).filter((b) =>
        standalone.includes(b),
      );
      if (matched.length === 0) continue;

      const existing = result.find((c) => c.id === community.id);
      if (existing) {
        existing.buildings = [...new Set([...existing.buildings, ...matched])];
        existing.totalBuildings = existing.buildings.length;
      } else if (!seen.has(community.id)) {
        result.push({ ...community, buildings: matched, totalBuildings: matched.length });
        seen.add(community.id);
      }
    }
  }

  return result;
}

/**
 * Main export — get communities for a user.
 * Returns { status, message, communities, totalCommunities }
 */
export async function getUserCommunities(email, role) {
  const safeEmail = String(email || "").trim();
  if (!safeEmail) {
    return {
      message: "Email is required",
      communities: [],
      totalCommunities: 0,
      status: false,
    };
  }

  const roleKey = normalizeRoleKey(role);

  try {
    // Admin and coordinator see everything
    if (roleKey === "admin" || roleKey === "coordinator") {
      const communities = await loadAllCommunitiesFromFirestore();
      return {
        message: `Retrieved ${communities.length} communities`,
        communities,
        totalCommunities: communities.length,
        status: true,
      };
    }

    const userDoc = await fetchUserDocByEmail(safeEmail);
    const userData = userDoc?.data() || {};
    const effectiveRole = normalizeRoleKey(role || userData.role || "");

    if (!userDoc) {
      if (isConsultantLikeRole(effectiveRole)) {
        const fallback = await consultantFallbackCommunities();
        return {
          message: "Loaded SALES community for consultant",
          communities: fallback,
          totalCommunities: fallback.length,
          status: true,
        };
      }
      return {
        message: "User not found",
        communities: [],
        totalCommunities: 0,
        status: false,
      };
    }

    let communities = await buildCommunitiesForUser(userData);

    if (isConsultantLikeRole(effectiveRole) && communities.length === 0) {
      communities = await consultantFallbackCommunities();
    }

    return {
      message: `Retrieved ${communities.length} assigned communities`,
      communities,
      totalCommunities: communities.length,
      status: true,
    };
  } catch (error) {
    console.error("Error fetching communities:", error);

    if (isConsultantLikeRole(roleKey)) {
      const fallback = await consultantFallbackCommunities();
      return {
        message: "Loaded communities (recovery)",
        communities: fallback,
        totalCommunities: fallback.length,
        status: true,
      };
    }

    return {
      message: error.message || "Failed to fetch communities",
      communities: [],
      totalCommunities: 0,
      status: false,
    };
  }
}
