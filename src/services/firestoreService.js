import { db, storage } from "@/config/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";
import { uploadFloorPlanImage, uploadNestedPlanImage } from "@/lib/floorPlanStorage";
import { sanitizeFloorPlanId, buildingCollectionName } from "@/lib/nestedFloorPlan";
import {
  buildingsMatch,
  buildClearFloorMapPositionPayload,
  buildClearNestedFloorMapPositionPayload,
  buildClearAssetPlacementPayload,
  buildNestedFloorMapAssetsListUpdate,
  pickerAssetMatchesMapping,
  getFloorMapName,
  hasFloorPosition,
  loadFloorMapAssetsFromAssetsList,
  loadNestedAssetMappingsFromAssetsList,
  mergeNestedAssetMappings,
  matchesFloorMap,
} from "@/lib/floorMapAssets";

/**
 * Frontend FirestoreService - Uses Firebase Client SDK
 * Mirrors the backend FirestoreService.js structure for consistency
 */
class FirestoreService {
  // ==================== ASSET MANAGEMENT ====================

  /**
   * Get all assets from AssetsList collection with names and details
   * @returns {Promise<{assetNames: Array<string>, assetsWithDetails: Array<object>}>}
   */
  static async getAssetNames() {
    try {
      const assetsCollection = collection(db, "AssetsList");
      const assetsSnapshot = await getDocs(assetsCollection);

      if (assetsSnapshot.empty) {
        return {
          assetNames: [],
          assetsWithDetails: [],
        };
      }

      // Extract unique asset names/descriptions from uploaded assets
      const assetNamesSet = new Set();
      const assetsWithDetails = [];

      assetsSnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        // Prioritize description, then assetId, then document id
        const assetName = data.description || data.assetId || docSnapshot.id;
        if (assetName) {
          assetNamesSet.add(assetName);
          assetsWithDetails.push({
            id: docSnapshot.id,
            name: assetName,
            description: data.description || "",
            assetId: data.assetId || "",
            brand: data.brand || "",
            system: data.system || "",
            partNumber: data.partNumber || "",
            category: data.category || data.system || "General",
            img_url: data.assetImageUrl || null,
            assetMode: "general",
            ...data,
          });
        }
      });

      const assetNames = Array.from(assetNamesSet).sort();

      return {
        assetNames,
        assetsWithDetails,
      };
    } catch (error) {
      console.error("Error getting asset names:", error);
      throw error;
    }
  }

  /**
   * Search assets by name from AssetsList collection
   * @param {string} searchName - Asset name to search for
   * @returns {Promise<{matchingAssets: Array<object>, categories: Array<string>, categoryNames: object}>}
   */
  static async searchAssetsByName(searchName) {
    try {
      const assetsCollection = collection(db, "AssetsList");
      const assetsSnapshot = await getDocs(assetsCollection);

      const matchingAssets = [];
      const categoriesSet = new Set();
      const categoryNames = {};

      assetsSnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        const assetName = data.description || data.assetId || docSnapshot.id;

        if (assetName === searchName) {
          const category = data.category || data.system || "General";
          categoriesSet.add(category);
          categoryNames[category] = data.categoryName || category;

          matchingAssets.push({
            id: docSnapshot.id,
            name: assetName,
            description: data.description || "",
            assetId: data.assetId || "",
            brand: data.brand || "",
            system: data.system || "",
            partNumber: data.partNumber || "",
            category: category,
            categoryName: data.categoryName || category,
            subCategory: data.subCategory || "",
            img_url: data.assetImageUrl || null,
            assetMode: "general",
            ...data,
          });
        }
      });

      return {
        matchingAssets,
        categories: Array.from(categoriesSet),
        categoryNames,
      };
    } catch (error) {
      console.error("Error searching assets by name:", error);
      throw error;
    }
  }

  /**
   * Get building assets by category
   * @param {string} buildingName - Building name (without suffix)
   * @returns {Promise<object>} - Building assets by category
   */
  static async getBuildingAssets(buildingName) {
    try {
      // Ensure buildingName has BuildingDB suffix
      const buildingDbName = buildingName.endsWith("BuildingDB")
        ? buildingName
        : `${buildingName}BuildingDB`;

      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "elv",
        "security",
        "vertical-transport",
        "lighting",
        "bms",
        "landscaping",
        "additional",
      ];

      const assets = {
        categories: {},
        categoriesFound: [],
      };

      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(
            db,
            buildingDbName,
            "asset",
            categoryKey,
          );
          const categorySnapshot = await getDocs(categoryCollection);

          if (!categorySnapshot.empty) {
            assets.categoriesFound.push(categoryKey);

            const categoryAssets = {};
            categorySnapshot.forEach((docSnapshot) => {
              const data = docSnapshot.data();
              categoryAssets[docSnapshot.id] = {
                id: docSnapshot.id,
                ...data,
              };
            });

            assets.categories[categoryKey] = {
              name: categoryKey,
              categoryInfo: { name: categoryKey },
              assets: categoryAssets,
            };
          }
        } catch (error) {
          console.error(`Error fetching category ${categoryKey}:`, error);
          // Continue with other categories
        }
      }

      return assets;
    } catch (error) {
      console.error("Error getting building assets:", error);
      throw error;
    }
  }

  /**
   * Update asset coordinates (X, Y, Z) and globalId from IFC/BIM data
   * @param {string} buildingName - Building name (without BuildingDB suffix)
   * @param {string} categoryKey - Asset category key
   * @param {string} assetId - Asset document ID
   * @param {object} coordinateData - Coordinate data to update
   * @returns {Promise<void>}
   */
  static async updateAssetCoordinates(
    buildingName,
    categoryKey,
    assetId,
    coordinateData,
  ) {
    try {
      const buildingDbName = buildingName.endsWith("BuildingDB")
        ? buildingName
        : `${buildingName}BuildingDB`;

      const assetRef = doc(db, buildingDbName, "asset", categoryKey, assetId);

      await updateDoc(assetRef, coordinateData);

      console.log(`Updated coordinates for asset ${assetId} in ${categoryKey}`);
    } catch (error) {
      console.error(`Error updating asset coordinates for ${assetId}:`, error);
      throw error;
    }
  }

  /**
   * Get building 3D model metadata
   * @param {string} buildingName - Building name (with or without BuildingDB suffix)
   * @returns {Promise<object|null>} - Metadata document or null
   */
  static async getBuildingModelMetadata(buildingName) {
    try {
      const buildingDbName = buildingName.endsWith("BuildingDB")
        ? buildingName
        : `${buildingName}BuildingDB`;

      const metadataRef = doc(db, buildingDbName, "metadata");
      const metadataSnap = await getDoc(metadataRef);

      if (!metadataSnap.exists()) {
        return null;
      }

      return metadataSnap.data();
    } catch (error) {
      console.error("Error getting building model metadata:", error);
      throw error;
    }
  }

  // ==================== FLOOR MAP OPERATIONS ====================

  /**
   * Get all floor plans for a building
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @returns {Promise<Array>} - List of floor plans
   */
  static async getBuildingFloorMaps(buildingName) {
    try {
      const floorsRef = collection(db, buildingName, "floorMaps", "floors");
      const floorsSnapshot = await getDocs(floorsRef);

      if (floorsSnapshot.empty) {
        return [];
      }

      const floorPlans = [];
      floorsSnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        floorPlans.push({
          name: docSnapshot.id,
          floorPlanName: data.floorPlanName || docSnapshot.id,
          buildingName: data.buildingName || buildingName,
          imageUrl: data.imageUrl,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          ...data,
        });
      });

      return floorPlans;
    } catch (error) {
      console.error("Error getting building floor maps:", error);
      throw error;
    }
  }

  /**
   * Get a specific floor map with asset mappings
   * Fetches assets from both the legacy assetMappings subcollection and the new asset/{category}/ structure
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @returns {Promise<object>} - Floor plan data with asset mappings
   */
  static async getFloorMap(buildingName, floorPlanName) {
    try {
      const floorRef = doc(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
      );
      const floorDoc = await getDoc(floorRef);

      if (!floorDoc.exists()) {
        throw new Error("Floor plan not found");
      }

      const floorData = floorDoc.data();
      const flatAssetMappings = [];

      // 1. Get asset mappings from legacy assetMappings subcollection (for backward compatibility)
      const mappingsRef = collection(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
        "assetMappings",
      );
      const mappingsSnapshot = await getDocs(mappingsRef);

      mappingsSnapshot.forEach((mappingDoc) => {
        const mapping = mappingDoc.data();
        flatAssetMappings.push({
          id: mapping.id || mappingDoc.id,
          assetName: mapping.assetName || mapping.id,
          category: mapping.category,
          x: mapping.x,
          y: mapping.y,
          active: mapping.active || 0,
          customImageUrl: mapping.customImageUrl || null,
          deviceLocation: mapping.deviceLocation || "",
          deviceAddress: mapping.deviceAddress || "",
          installed: mapping.installed || false,
          activityStatus:
            mapping.activityStatus !== undefined ? mapping.activityStatus : 1,
          enabled: mapping.enabled !== undefined ? mapping.enabled : true,
        });
      });

      // 2. Get assets from asset/{category}/ collections that have matching floorName (new structure)
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "elv",
        "security",
        "vertical-transport",
        "lighting",
        "bms",
        "landscaping",
        "additional",
      ];

      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(
            db,
            buildingName,
            "asset",
            categoryKey,
          );
          const categorySnapshot = await getDocs(categoryCollection);

          categorySnapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data();
            const assetFloorName = getFloorMapName(data);
            // Only include assets placed on this floor map
            if (assetFloorName === floorPlanName && hasFloorPosition(data)) {
              flatAssetMappings.push({
                id: data.buildingAssetId || docSnapshot.id,
                assetName: data.assetName || docSnapshot.id,
                category: data.mainCategory || categoryKey,
                categoryKey: data.assetCategory || categoryKey,
                x: data.x || 0,
                y: data.y || 0,
                relativeX: data.relativeX,
                relativeY: data.relativeY,
                floorMapName: assetFloorName,
                floorPlanName: assetFloorName,
                building: data.building || data.buildingName,
                active: data.active || 0,
                customImageUrl: data.customImageUrl || null,
                deviceLocation: data.deviceLocation || "",
                deviceAddress: data.deviceAddress || "",
                installed: data.installed || false,
                activityStatus:
                  data.activityStatus !== undefined ? data.activityStatus : 1,
                enabled: data.enabled !== undefined ? data.enabled : true,
                assetMode: data.assetMode || "building",
              });
            }
          });
        } catch (error) {
          console.error(`Error fetching category ${categoryKey}:`, error);
          // Continue with other categories
        }
      }

      const buildingShortName = buildingName.endsWith("BuildingDB")
        ? buildingName.slice(0, -"BuildingDB".length)
        : buildingName;
      const assetsListMappings = await loadFloorMapAssetsFromAssetsList(
        db,
        buildingShortName,
        floorPlanName,
      );
      assetsListMappings.forEach((asset) => {
        const exists = flatAssetMappings.some(
          (m) => m.assetsListId === asset.assetsListId || m.id === asset.id,
        );
        if (!exists) flatAssetMappings.push(asset);
      });

      return {
        floorPlanName: floorData.floorPlanName || floorPlanName,
        buildingName: floorData.buildingName || buildingName,
        imageUrl: floorData.imageUrl,
        assetMappings: flatAssetMappings,
        createdAt: floorData.createdAt,
        updatedAt: floorData.updatedAt,
      };
    } catch (error) {
      console.error("Error getting floor map:", error);
      throw error;
    }
  }

  /**
   * Remove floor-map placement fields from AssetsList and building asset docs.
   */
  static async clearPlacementsForFloorMap(buildingName, floorPlanName) {
    const shortBuilding = buildingName.replace(/BuildingDB$/i, "");
    const now = new Date().toISOString();
    const updates = [];

    const categoryKeys = [
      "fire-life-safety",
      "electrical",
      "hvac",
      "plumbing",
      "elv",
      "security",
      "vertical-transport",
      "lighting",
      "bms",
      "landscaping",
      "additional",
    ];

    const assetsListSnap = await getDocs(collection(db, "AssetsList"));
    assetsListSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (!buildingsMatch(data.building, shortBuilding)) return;
      if (!matchesFloorMap(data, floorPlanName)) return;
      if (!hasFloorPosition(data)) return;

      updates.push(
        updateDoc(doc(db, "AssetsList", docSnap.id), {
          ...buildClearFloorMapPositionPayload(),
          building: "",
          updatedAt: now,
        }),
      );
    });

    for (const categoryKey of categoryKeys) {
      try {
        const categorySnapshot = await getDocs(
          collection(db, buildingName, "asset", categoryKey),
        );
        categorySnapshot.forEach((assetDoc) => {
          const data = assetDoc.data();
          if (!matchesFloorMap(data, floorPlanName)) return;
          if (!hasFloorPosition(data)) return;

          updates.push(
            updateDoc(
              doc(db, buildingName, "asset", categoryKey, assetDoc.id),
              {
                x: deleteField(),
                y: deleteField(),
                relativeX: deleteField(),
                relativeY: deleteField(),
                floorPlanName: deleteField(),
                floorMapName: deleteField(),
                position: deleteField(),
                updatedAt: now,
              },
            ),
          );
        });
      } catch (error) {
        console.error(
          `Error clearing floor placements in ${categoryKey}:`,
          error,
        );
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }

    return updates.length;
  }

  /**
   * Delete a floor map
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @returns {Promise<void>}
   */
  static async deleteFloorMap(buildingName, floorPlanName) {
    try {
      await this.clearPlacementsForFloorMap(buildingName, floorPlanName);

      const floorRef = doc(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
      );

      // Delete asset mappings subcollection first
      const mappingsRef = collection(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
        "assetMappings",
      );
      const mappingsSnapshot = await getDocs(mappingsRef);

      const deletePromises = [];
      mappingsSnapshot.forEach((docSnapshot) => {
        deletePromises.push(
          deleteDoc(
            doc(
              db,
              buildingName,
              "floorMaps",
              "floors",
              floorPlanName,
              "assetMappings",
              docSnapshot.id,
            ),
          ),
        );
      });

      await Promise.all(deletePromises);

      // Delete the floor plan document
      await deleteDoc(floorRef);
    } catch (error) {
      console.error("Error deleting floor map:", error);
      throw error;
    }
  }

  /**
   * Update floor map image
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @param {File} imageFile - Image file to upload
   * @returns {Promise<string>} - New image URL
   */
  static async updateFloorMapImage(buildingName, floorPlanName, imageFile) {
    try {
      const imageUrl = await uploadFloorPlanImage(
        buildingName,
        floorPlanName,
        imageFile,
      );

      // Update floor plan document with new image URL
      const floorRef = doc(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
      );
      await updateDoc(floorRef, {
        imageUrl: imageUrl,
        updatedAt: new Date().toISOString(),
      });

      return imageUrl;
    } catch (error) {
      console.error("Error updating floor map image:", error);
      throw error;
    }
  }

  /**
   * Update floor map asset mappings
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @param {Array} assetMappings - Array of asset mappings
   * @returns {Promise<void>}
   */
  static async updateFloorMapAssets(
    buildingName,
    floorPlanName,
    assetMappings,
  ) {
    try {
      const floorRef = doc(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
      );
      const mappingsRef = collection(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
        "assetMappings",
      );

      // Delete existing asset mappings
      const existingMappings = await getDocs(mappingsRef);
      const deletePromises = [];
      existingMappings.forEach((docSnapshot) => {
        deletePromises.push(
          deleteDoc(
            doc(
              db,
              buildingName,
              "floorMaps",
              "floors",
              floorPlanName,
              "assetMappings",
              docSnapshot.id,
            ),
          ),
        );
      });
      await Promise.all(deletePromises);

      // Helper function to sanitize document IDs
      const sanitizeDocumentId = (id) => {
        return id
          .replace(/[\/\\]/g, "_")
          .replace(/[()]/g, "")
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .substring(0, 100);
      };

      // Add new asset mappings with generated IDs
      const addPromises = [];
      assetMappings.forEach((mapping, index) => {
        const sanitizedAssetName = sanitizeDocumentId(mapping.assetName);
        const docId = `${sanitizedAssetName}_${index}`;
        const mappingDocRef = doc(
          db,
          buildingName,
          "floorMaps",
          "floors",
          floorPlanName,
          "assetMappings",
          docId,
        );

        addPromises.push(
          setDoc(mappingDocRef, {
            id: mapping.assetName,
            assetName: mapping.assetName,
            category: mapping.category,
            x: mapping.x,
            y: mapping.y,
            active: mapping.active || 0,
            customImageUrl: mapping.customImageUrl || null,
            deviceLocation: mapping.deviceLocation || "",
            deviceAddress: mapping.deviceAddress || "",
            installed: mapping.installed || false,
            activityStatus:
              mapping.activityStatus !== undefined ? mapping.activityStatus : 1,
            enabled: mapping.enabled !== undefined ? mapping.enabled : true,
            createdAt: new Date().toISOString(),
          }),
        );
      });

      await Promise.all(addPromises);

      // Update floor plan's updatedAt timestamp
      await updateDoc(floorRef, {
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error updating floor map assets:", error);
      throw error;
    }
  }

  /**
   * Create a new floor plan
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @param {string} imageUrl - Image URL
   * @returns {Promise<void>}
   */
  static async createFloorPlan(buildingName, floorPlanName, imageUrl) {
    try {
      const floorRef = doc(
        db,
        buildingName,
        "floorMaps",
        "floors",
        floorPlanName,
      );
      await setDoc(floorRef, {
        floorPlanName: floorPlanName,
        buildingName: buildingName,
        imageUrl: imageUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error creating floor plan:", error);
      throw error;
    }
  }

  // ==================== NESTED FLOOR PLAN OPERATIONS ====================

  static _nestedBuildingRef(buildingName) {
    const coll = buildingCollectionName(buildingName);
    return doc(db, coll, "floorMaps", "building");
  }

  static _nestedFloorRef(buildingName, floorId) {
    const coll = buildingCollectionName(buildingName);
    return doc(db, coll, "floorMaps", "floors", floorId);
  }

  static _nestedSectionRef(buildingName, floorId, sectionId) {
    const coll = buildingCollectionName(buildingName);
    return doc(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
    );
  }

  static _nestedSubsectionRef(buildingName, floorId, sectionId, subsectionId) {
    const coll = buildingCollectionName(buildingName);
    return doc(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "subsections",
      subsectionId,
    );
  }

  /** Building overview: image + floor list (step 1). */
  static async getBuildingOverview(buildingName) {
    const ref = this._nestedBuildingRef(buildingName);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  static async saveBuildingOverview(buildingName, { buildingImageUrl, floors = [] }) {
    const ref = this._nestedBuildingRef(buildingName);
    const now = new Date().toISOString();
    const existing = await getDoc(ref);
    const payload = {
      buildingImageUrl: buildingImageUrl || "",
      floors: floors.map((f, index) => ({
        id: f.id || sanitizeFloorPlanId(f.name),
        name: f.name,
        order: typeof f.order === "number" ? f.order : index,
        ...(typeof f.x === "number" ? { x: f.x, y: f.y } : {}),
        ...(typeof f.relativeX === "number"
          ? { relativeX: f.relativeX, relativeY: f.relativeY }
          : {}),
      })),
      updatedAt: now,
      ...(existing.exists() ? {} : { createdAt: now }),
    };
    await setDoc(ref, payload, { merge: true });
    return payload;
  }

  static async uploadBuildingOverviewImage(buildingName, imageFile) {
    const coll = buildingCollectionName(buildingName);
    const imageUrl = await uploadNestedPlanImage(coll, "building/overview", imageFile);
    const ref = this._nestedBuildingRef(buildingName);
    const now = new Date().toISOString();
    await setDoc(
      ref,
      { buildingImageUrl: imageUrl, updatedAt: now, createdAt: now },
      { merge: true },
    );
    return imageUrl;
  }

  /** All floors for a building. */
  static async getNestedFloors(buildingName) {
    const coll = buildingCollectionName(buildingName);
    const floorsRef = collection(db, coll, "floorMaps", "floors");
    const snap = await getDocs(floorsRef);
    const floors = [];
    snap.forEach((d) => floors.push({ id: d.id, ...d.data() }));
    floors.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return floors;
  }

  static async getNestedFloor(buildingName, floorId) {
    const ref = this._nestedFloorRef(buildingName, floorId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  static async saveNestedFloor(buildingName, floor) {
    const id = floor.id || sanitizeFloorPlanId(floor.name);
    const ref = this._nestedFloorRef(buildingName, id);
    const now = new Date().toISOString();
    const existing = await getDoc(ref);
    const payload = {
      id,
      name: floor.name,
      imageUrl: floor.imageUrl || "",
      order: floor.order ?? 0,
      sectionMarkers: floor.sectionMarkers || [],
      updatedAt: now,
      ...(existing.exists() ? {} : { createdAt: now }),
    };
    await setDoc(ref, payload, { merge: true });
    return payload;
  }

  static async uploadNestedFloorImage(buildingName, floorId, imageFile) {
    const coll = buildingCollectionName(buildingName);
    const imageUrl = await uploadNestedPlanImage(
      coll,
      `floors/${floorId}`,
      imageFile,
    );
    const ref = this._nestedFloorRef(buildingName, floorId);
    await updateDoc(ref, { imageUrl, updatedAt: new Date().toISOString() });
    return imageUrl;
  }

  static async deleteNestedFloor(buildingName, floorId) {
    const sections = await this.getNestedSections(buildingName, floorId);
    for (const section of sections) {
      await this.deleteNestedSection(buildingName, floorId, section.id);
    }
    await this._clearSourceAssetsForFloor(buildingName, floorId);
    await deleteDoc(this._nestedFloorRef(buildingName, floorId));

    const overview = await this.getBuildingOverview(buildingName);
    if (overview?.floors?.length) {
      const updatedFloors = overview.floors.filter((f) => f.id !== floorId);
      await this.saveBuildingOverview(buildingName, {
        buildingImageUrl: overview.buildingImageUrl || "",
        floors: updatedFloors,
      });
    }
  }

  /** Sections within a floor (step 2). */
  static async getNestedSections(buildingName, floorId) {
    const coll = buildingCollectionName(buildingName);
    const ref = collection(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
    );
    const snap = await getDocs(ref);
    const sections = [];
    snap.forEach((d) => sections.push({ id: d.id, ...d.data() }));
    return sections;
  }

  static async getNestedSection(buildingName, floorId, sectionId) {
    const ref = this._nestedSectionRef(buildingName, floorId, sectionId);
    const [snap, assetMappings] = await Promise.all([
      getDoc(ref),
      this.getSectionAssetMappings(buildingName, floorId, sectionId),
    ]);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data(), assetMappings };
  }

  static async saveNestedSection(buildingName, floorId, section) {
    const id = section.id || sanitizeFloorPlanId(section.name);
    const ref = this._nestedSectionRef(buildingName, floorId, id);
    const now = new Date().toISOString();
    const existing = await getDoc(ref);
    const payload = {
      id,
      name: section.name,
      imageUrl: section.imageUrl || "",
      subsectionMarkers: section.subsectionMarkers || [],
      updatedAt: now,
      ...(existing.exists() ? {} : { createdAt: now }),
    };
    await setDoc(ref, payload, { merge: true });

    // Keep floor-level navigation markers in sync
    const floor = await this.getNestedFloor(buildingName, floorId);
    if (floor) {
      const markers = [...(floor.sectionMarkers || [])];
      const idx = markers.findIndex((m) => m.sectionId === id);
      const entry = {
        id: `section_${id}`,
        sectionId: id,
        name: section.name,
        ...(idx >= 0 ? markers[idx] : {}),
      };
      if (idx >= 0) markers[idx] = { ...markers[idx], name: section.name };
      else markers.push(entry);
      await updateDoc(this._nestedFloorRef(buildingName, floorId), {
        sectionMarkers: markers,
        updatedAt: now,
      });
    }

    return payload;
  }

  static async updateFloorSectionMarkers(buildingName, floorId, sectionMarkers) {
    await updateDoc(this._nestedFloorRef(buildingName, floorId), {
      sectionMarkers,
      updatedAt: new Date().toISOString(),
    });
  }

  static async uploadNestedSectionImage(buildingName, floorId, sectionId, imageFile) {
    const coll = buildingCollectionName(buildingName);
    const imageUrl = await uploadNestedPlanImage(
      coll,
      `floors/${floorId}/sections/${sectionId}`,
      imageFile,
    );
    const ref = this._nestedSectionRef(buildingName, floorId, sectionId);
    await updateDoc(ref, { imageUrl, updatedAt: new Date().toISOString() });
    return imageUrl;
  }

  static async deleteNestedSection(buildingName, floorId, sectionId) {
    const subsections = await this.getNestedSubsections(
      buildingName,
      floorId,
      sectionId,
    );
    for (const sub of subsections) {
      await this.deleteNestedSubsection(buildingName, floorId, sectionId, sub.id);
    }

    const sectionMappingsRef = collection(
      db,
      buildingCollectionName(buildingName),
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "assetMappings",
    );
    const sectionMappingsSnap = await getDocs(sectionMappingsRef);
    const sectionMappings = this._mappingsFromSnapshot(sectionMappingsSnap);
    await this._clearNestedMappingsFromSourceAssets(buildingName, sectionMappings);
    await Promise.all(sectionMappingsSnap.docs.map((d) => deleteDoc(d.ref)));

    await deleteDoc(this._nestedSectionRef(buildingName, floorId, sectionId));

    const floor = await this.getNestedFloor(buildingName, floorId);
    if (floor?.sectionMarkers) {
      const markers = floor.sectionMarkers.filter((m) => m.sectionId !== sectionId);
      await this.updateFloorSectionMarkers(buildingName, floorId, markers);
    }
  }

  /** Subsections within a section (step 3). */
  static async getNestedSubsections(buildingName, floorId, sectionId) {
    const coll = buildingCollectionName(buildingName);
    const ref = collection(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "subsections",
    );
    const snap = await getDocs(ref);
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    return items;
  }

  static async getNestedSubsection(buildingName, floorId, sectionId, subsectionId) {
    const ref = this._nestedSubsectionRef(
      buildingName,
      floorId,
      sectionId,
      subsectionId,
    );
    const [snap, assetMappings] = await Promise.all([
      getDoc(ref),
      this.getSubsectionAssetMappings(
        buildingName,
        floorId,
        sectionId,
        subsectionId,
      ),
    ]);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data(), assetMappings };
  }

  static async saveNestedSubsection(buildingName, floorId, sectionId, subsection) {
    const id = subsection.id || sanitizeFloorPlanId(subsection.name);
    const ref = this._nestedSubsectionRef(buildingName, floorId, sectionId, id);
    const now = new Date().toISOString();
    const existing = await getDoc(ref);
    const payload = {
      id,
      name: subsection.name,
      imageUrl: subsection.imageUrl || "",
      updatedAt: now,
      ...(existing.exists() ? {} : { createdAt: now }),
    };
    await setDoc(ref, payload, { merge: true });

    const section = await this.getNestedSection(buildingName, floorId, sectionId);
    if (section) {
      const markers = [...(section.subsectionMarkers || [])];
      const idx = markers.findIndex((m) => m.subsectionId === id);
      const entry = {
        id: `subsection_${id}`,
        subsectionId: id,
        name: subsection.name,
        ...(idx >= 0 ? markers[idx] : {}),
      };
      if (idx >= 0) markers[idx] = { ...markers[idx], name: subsection.name };
      else markers.push(entry);
      await updateDoc(this._nestedSectionRef(buildingName, floorId, sectionId), {
        subsectionMarkers: markers,
        updatedAt: now,
      });
    }

    return payload;
  }

  static async updateSectionSubsectionMarkers(
    buildingName,
    floorId,
    sectionId,
    subsectionMarkers,
  ) {
    await updateDoc(this._nestedSectionRef(buildingName, floorId, sectionId), {
      subsectionMarkers,
      updatedAt: new Date().toISOString(),
    });
  }

  static async uploadNestedSubsectionImage(
    buildingName,
    floorId,
    sectionId,
    subsectionId,
    imageFile,
  ) {
    const coll = buildingCollectionName(buildingName);
    const imageUrl = await uploadNestedPlanImage(
      coll,
      `floors/${floorId}/sections/${sectionId}/subsections/${subsectionId}`,
      imageFile,
    );
    const ref = this._nestedSubsectionRef(
      buildingName,
      floorId,
      sectionId,
      subsectionId,
    );
    await updateDoc(ref, { imageUrl, updatedAt: new Date().toISOString() });
    return imageUrl;
  }

  static async deleteNestedSubsection(
    buildingName,
    floorId,
    sectionId,
    subsectionId,
  ) {
    const mappingsRef = collection(
      db,
      buildingCollectionName(buildingName),
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "subsections",
      subsectionId,
      "assetMappings",
    );
    const mappingsSnap = await getDocs(mappingsRef);
    const mappings = this._mappingsFromSnapshot(mappingsSnap);
    await this._clearNestedMappingsFromSourceAssets(buildingName, mappings);
    await Promise.all(mappingsSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(
      this._nestedSubsectionRef(buildingName, floorId, sectionId, subsectionId),
    );

    const section = await this.getNestedSection(buildingName, floorId, sectionId);
    if (section?.subsectionMarkers) {
      const markers = section.subsectionMarkers.filter(
        (m) => m.subsectionId !== subsectionId,
      );
      await this.updateSectionSubsectionMarkers(
        buildingName,
        floorId,
        sectionId,
        markers,
      );
    }
  }

  /** Asset mappings directly on a section plan (subsections optional). */
  static _mappingsFromSnapshot(snap) {
    const mappings = [];
    snap.forEach((d) => mappings.push({ id: d.id, ...d.data() }));
    return mappings;
  }

  static async _clearNestedMappingsFromSourceAssets(buildingName, mappings) {
    const coll = buildingCollectionName(buildingName);
    const payload = buildClearNestedFloorMapPositionPayload();
    const updates = [];

    (mappings || []).forEach((mapping) => {
      if (mapping.assetMode === "general" && mapping.assetsListId) {
        updates.push(
          updateDoc(doc(db, "AssetsList", mapping.assetsListId), payload),
        );
      } else if (
        mapping.assetMode === "building" &&
        mapping.category &&
        mapping.buildingAssetId
      ) {
        updates.push(
          updateDoc(
            doc(db, coll, "asset", mapping.category, mapping.buildingAssetId),
            payload,
          ),
        );
      }
    });

    if (updates.length > 0) {
      await Promise.all(updates);
    }
  }

  /** Remove nested placement fields from any source asset tagged with this floor. */
  static async _clearSourceAssetsForFloor(buildingName, floorId) {
    if (!floorId) return;
    const coll = buildingCollectionName(buildingName);
    const payload = buildClearNestedFloorMapPositionPayload();
    const updates = [];
    const shortBuilding = buildingName.replace(/BuildingDB$/i, "");

    const assetsListSnap = await getDocs(collection(db, "AssetsList"));
    assetsListSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (
        !buildingsMatch(data.building, shortBuilding) &&
        !buildingsMatch(data.buildingName, shortBuilding)
      ) {
        return;
      }
      if (data.floorId === floorId || data.floorDetails?.id === floorId) {
        updates.push(updateDoc(doc(db, "AssetsList", docSnap.id), payload));
      }
    });

    const categoryKeys = [
      "fire-life-safety",
      "electrical",
      "hvac",
      "plumbing",
      "elv",
      "security",
      "vertical-transport",
      "lighting",
      "bms",
      "landscaping",
      "additional",
    ];

    for (const categoryKey of categoryKeys) {
      try {
        const categorySnapshot = await getDocs(
          collection(db, coll, "asset", categoryKey),
        );
        categorySnapshot.forEach((assetDoc) => {
          const data = assetDoc.data();
          if (data.floorId === floorId || data.floorDetails?.id === floorId) {
            updates.push(
              updateDoc(
                doc(db, coll, "asset", categoryKey, assetDoc.id),
                payload,
              ),
            );
          }
        });
      } catch {
        /* category may not exist */
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }
  }

  static async _syncNestedMappingsToSourceAssets(buildingName, mappings) {
    const operations = this._buildNestedMappingSyncOperations(buildingName, mappings);
    await this._commitWriteBatches(operations);
  }

  static _stripUndefinedDeep(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value
        .map((item) => this._stripUndefinedDeep(item))
        .filter((item) => item !== undefined);
    }

    const cleaned = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (nestedValue === undefined) return;
      const nextValue = this._stripUndefinedDeep(nestedValue);
      if (nextValue !== undefined) cleaned[key] = nextValue;
    });
    return cleaned;
  }

  static _dedupeAssetMappingsForSave(mappings = []) {
    const byKey = new Map();

    mappings.forEach((mapping, index) => {
      let key = "";
      if (mapping.assetMode === "general") {
        key = `general::${mapping.assetsListId || mapping.id || ""}`;
      } else if (mapping.assetMode === "building") {
        key = `building::${mapping.category || ""}::${mapping.buildingAssetId || ""}`;
      }

      if (!key || key.endsWith("::") || key === "general::") {
        key = `row::${mapping.id || index}`;
      }

      byKey.set(key, mapping);
    });

    return Array.from(byKey.values());
  }

  static _dedupeSyncOperations(operations = []) {
    const byRef = new Map();
    operations.forEach((operation) => {
      byRef.set(operation.ref.path, operation);
    });
    return Array.from(byRef.values());
  }

  static _mappingFirestoreDocumentId(mapping, index) {
    const stableKey =
      mapping.assetsListId ||
      mapping.buildingAssetId ||
      mapping.id ||
      `idx${index}`;
    const sanitized = this._sanitizeMappingDocumentId(stableKey) || `idx${index}`;
    return `m_${index}_${sanitized}`.substring(0, 150);
  }

  static _sanitizeMappingDocumentId(id) {
    return String(id || "")
      .replace(/[\/\\]/g, "_")
      .replace(/[()]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .substring(0, 100);
  }

  static _buildNestedMappingSyncOperations(
    buildingName,
    mappings,
    now = new Date().toISOString(),
  ) {
    const coll = buildingCollectionName(buildingName);
    const operations = [];

    (mappings || []).forEach((mapping) => {
      const payload = this._stripUndefinedDeep(
        buildNestedFloorMapAssetsListUpdate({ mapping, now }),
      );

      if (mapping.assetMode === "general" && mapping.assetsListId) {
        operations.push({
          type: "set",
          ref: doc(db, "AssetsList", mapping.assetsListId),
          data: payload,
          merge: true,
        });
      } else if (
        mapping.assetMode === "building" &&
        mapping.category &&
        mapping.buildingAssetId
      ) {
        operations.push({
          type: "set",
          ref: doc(db, coll, "asset", mapping.category, mapping.buildingAssetId),
          data: payload,
          merge: true,
        });
      }
    });

    return this._dedupeSyncOperations(operations);
  }

  static _buildNestedMappingClearOperations(
    buildingName,
    mappings,
    now = new Date().toISOString(),
  ) {
    const coll = buildingCollectionName(buildingName);
    const clearPayload = {
      ...buildClearAssetPlacementPayload(now),
      coordinates: deleteField(),
    };
    const operations = [];

    (mappings || []).forEach((mapping) => {
      if (mapping.assetMode === "general" && mapping.assetsListId) {
        operations.push({
          type: "update",
          ref: doc(db, "AssetsList", mapping.assetsListId),
          data: clearPayload,
        });
      } else if (
        mapping.assetMode === "building" &&
        mapping.category &&
        mapping.buildingAssetId
      ) {
        operations.push({
          type: "update",
          ref: doc(db, coll, "asset", mapping.category, mapping.buildingAssetId),
          data: clearPayload,
        });
      }
    });

    return this._dedupeSyncOperations(operations);
  }

  static _findRemovedAssetMappings(existingMappings = [], nextMappings = []) {
    return existingMappings.filter(
      (existingMapping) =>
        !nextMappings.some((newMapping) =>
          pickerAssetMatchesMapping(
            {
              assetMode: newMapping.assetMode || "general",
              assetsListId: newMapping.assetsListId,
              id: newMapping.buildingAssetId || newMapping.assetsListId,
              category: newMapping.category,
            },
            existingMapping,
          ),
        ),
    );
  }

  static async _replaceNestedAssetMappings(mappingsRef, existingDocs, assetMappings) {
    const dedupedMappings = this._dedupeAssetMappingsForSave(assetMappings);
    const now = new Date().toISOString();
    const operations = existingDocs.map((existingDoc) => ({
      type: "delete",
      ref: existingDoc.ref,
    }));

    dedupedMappings.forEach((mapping, index) => {
      const docId = this._mappingFirestoreDocumentId(mapping, index);
      operations.push({
        type: "set",
        ref: doc(mappingsRef, docId),
        data: this._stripUndefinedDeep({
          ...mapping,
          createdAt: mapping.createdAt || now,
        }),
      });
    });

    await this._commitWriteBatches(operations);
    return dedupedMappings;
  }

  static async _commitWriteBatches(operations) {
    if (!operations?.length) return;

    const chunkSize = 450;
    for (let i = 0; i < operations.length; i += chunkSize) {
      const chunk = operations.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach(({ type, ref, data, merge = false }) => {
        if (type === "set") {
          batch.set(ref, data, merge ? { merge: true } : {});
        } else if (type === "update") {
          batch.update(ref, data);
        } else if (type === "delete") {
          batch.delete(ref);
        }
      });
      await batch.commit();
    }
  }

  static async getSectionAssetMappings(buildingName, floorId, sectionId) {
    const coll = buildingCollectionName(buildingName);
    const mappingsRef = collection(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "assetMappings",
    );
    const [snap, fromAssetsList] = await Promise.all([
      getDocs(mappingsRef),
      loadNestedAssetMappingsFromAssetsList(db, buildingName, {
        floorId,
        sectionId,
        placementLevel: "section",
      }),
    ]);
    const mappings = [];
    snap.forEach((d) => mappings.push({ id: d.id, ...d.data() }));
    return mergeNestedAssetMappings(mappings, fromAssetsList);
  }

  static async updateSectionAssetMappings(
    buildingName,
    floorId,
    sectionId,
    assetMappings,
  ) {
    const coll = buildingCollectionName(buildingName);
    const mappingsRef = collection(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "assetMappings",
    );

    const existing = await getDocs(mappingsRef);
    const existingMappings = existing.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    const now = new Date().toISOString();
    const dedupedMappings = this._dedupeAssetMappingsForSave(assetMappings);
    const removedMappings = this._findRemovedAssetMappings(
      existingMappings,
      dedupedMappings,
    );
    const syncOperations = this._buildNestedMappingSyncOperations(
      buildingName,
      dedupedMappings,
      now,
    );
    const clearOperations = this._buildNestedMappingClearOperations(
      buildingName,
      removedMappings,
      now,
    );

    const savedMappings = await this._replaceNestedAssetMappings(
      mappingsRef,
      existing.docs,
      dedupedMappings,
    );
    await this._commitWriteBatches([...syncOperations, ...clearOperations]);

    await updateDoc(this._nestedSectionRef(buildingName, floorId, sectionId), {
      updatedAt: now,
    });

    return savedMappings;
  }

  /** Asset mappings on subsection plan (optional deeper level). */
  static async getSubsectionAssetMappings(
    buildingName,
    floorId,
    sectionId,
    subsectionId,
  ) {
    const coll = buildingCollectionName(buildingName);
    const mappingsRef = collection(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "subsections",
      subsectionId,
      "assetMappings",
    );
    const [snap, fromAssetsList] = await Promise.all([
      getDocs(mappingsRef),
      loadNestedAssetMappingsFromAssetsList(db, buildingName, {
        floorId,
        sectionId,
        subsectionId,
        placementLevel: "subsection",
      }),
    ]);
    const mappings = [];
    snap.forEach((d) => mappings.push({ id: d.id, ...d.data() }));
    return mergeNestedAssetMappings(mappings, fromAssetsList);
  }

  static async _deleteMatchingNestedMappingDocs(mappingsRef, asset) {
    const snap = await getDocs(mappingsRef);
    const deleteOps = [];

    snap.forEach((docSnap) => {
      const mapping = { ...docSnap.data(), id: docSnap.data().id || docSnap.id };
      if (pickerAssetMatchesMapping(asset, mapping)) {
        deleteOps.push(deleteDoc(docSnap.ref));
      }
    });

    if (deleteOps.length > 0) {
      await Promise.all(deleteOps);
    }

    return deleteOps.length;
  }

  /**
   * Remove an asset from nested floor-plan mappings and clear placement fields
   * on the source AssetsList / building asset document (including coordinates).
   *
   * When `options.localMappings` is provided (current editor view), that full list
   * is persisted so other placed assets on the same plan are not wiped.
   */
  static async removeAssetNestedPlacement(buildingName, asset = {}, options = {}) {
    const coll = buildingCollectionName(buildingName);
    const now = new Date().toISOString();
    const clearPayload = {
      ...buildClearAssetPlacementPayload(now),
      coordinates: deleteField(),
    };

    const hasLocalMappings = Array.isArray(options.localMappings);
    const localFloorId = options.floorId || "";
    const localSectionId = options.sectionId || "";
    const localSubsectionId = options.subsectionId || "";
    const localPlacementLevel = options.placementLevel || "section";

    if (
      hasLocalMappings &&
      localFloorId &&
      localSectionId &&
      (localPlacementLevel !== "subsection" || localSubsectionId)
    ) {
      if (localPlacementLevel === "subsection" && localSubsectionId) {
        await this.updateSubsectionAssetMappings(
          buildingName,
          localFloorId,
          localSectionId,
          localSubsectionId,
          options.localMappings,
        );
      } else {
        await this.updateSectionAssetMappings(
          buildingName,
          localFloorId,
          localSectionId,
          options.localMappings,
        );
      }
    } else {
      const floorId = asset.floorId || asset.floorDetails?.id || "";
      const sectionId = asset.sectionId || asset.sectionDetails?.id || "";
      const subsectionId = asset.subsectionId || asset.subsectionDetails?.id || "";
      const placementLevel =
        asset.placementLevel || (subsectionId ? "subsection" : "section");

      if (floorId && sectionId) {
        if (placementLevel === "subsection" && subsectionId) {
          const mappingsRef = collection(
            db,
            coll,
            "floorMaps",
            "floors",
            floorId,
            "sections",
            sectionId,
            "subsections",
            subsectionId,
            "assetMappings",
          );
          await this._deleteMatchingNestedMappingDocs(mappingsRef, asset);
        } else {
          const mappingsRef = collection(
            db,
            coll,
            "floorMaps",
            "floors",
            floorId,
            "sections",
            sectionId,
            "assetMappings",
          );
          await this._deleteMatchingNestedMappingDocs(mappingsRef, asset);
        }
      }
    }

    if (asset.assetMode === "general" || asset.assetsListId) {
      const listId = asset.assetsListId || asset.id;
      if (listId) {
        await updateDoc(doc(db, "AssetsList", listId), clearPayload);
      }
      return;
    }

    if (asset.category && asset.id) {
      await updateDoc(doc(db, coll, "asset", asset.category, asset.id), clearPayload);
    }
  }

  static async updateSubsectionAssetMappings(
    buildingName,
    floorId,
    sectionId,
    subsectionId,
    assetMappings,
  ) {
    const coll = buildingCollectionName(buildingName);
    const mappingsRef = collection(
      db,
      coll,
      "floorMaps",
      "floors",
      floorId,
      "sections",
      sectionId,
      "subsections",
      subsectionId,
      "assetMappings",
    );

    const existing = await getDocs(mappingsRef);
    const existingMappings = existing.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    const now = new Date().toISOString();
    const dedupedMappings = this._dedupeAssetMappingsForSave(assetMappings);
    const removedMappings = this._findRemovedAssetMappings(
      existingMappings,
      dedupedMappings,
    );
    const syncOperations = this._buildNestedMappingSyncOperations(
      buildingName,
      dedupedMappings,
      now,
    );
    const clearOperations = this._buildNestedMappingClearOperations(
      buildingName,
      removedMappings,
      now,
    );

    const savedMappings = await this._replaceNestedAssetMappings(
      mappingsRef,
      existing.docs,
      dedupedMappings,
    );
    await this._commitWriteBatches([...syncOperations, ...clearOperations]);

    await updateDoc(
      this._nestedSubsectionRef(buildingName, floorId, sectionId, subsectionId),
      { updatedAt: now },
    );

    return savedMappings;
  }

  /** Full nested tree for a building (viewer / editor bootstrap). */
  static async getNestedFloorPlanTree(buildingName) {
    const overview = await this.getBuildingOverview(buildingName);
    const floors = await this.getNestedFloors(buildingName);
    return { overview, floors };
  }

  // ==================== BUILDING MANAGEMENT ====================

  /**
   * Get building status from buildingDetails
   * @param {string} buildingName - Building name (without suffix)
   * @returns {Promise<string|null>} - Building status
   */
  static async getBuildingStatus(buildingName) {
    try {
      const buildingCollectionName = `${buildingName}BuildingDB`;
      const buildingDetailsRef = doc(
        db,
        buildingCollectionName,
        "buildingDetails",
      );
      const buildingDetailsSnap = await getDoc(buildingDetailsRef);

      if (buildingDetailsSnap.exists()) {
        const data = buildingDetailsSnap.data();
        return data.buildingStatus || null;
      }

      return null;
    } catch (error) {
      console.error("Error getting building status:", error);
      throw error;
    }
  }

  /**
   * Get building details
   * @param {string} buildingName - Building name (without suffix)
   * @returns {Promise<object|null>} - Building details
   */
  static async getBuildingDetails(buildingName) {
    try {
      const buildingCollectionName = `${buildingName}BuildingDB`;
      const buildingDetailsRef = doc(
        db,
        buildingCollectionName,
        "buildingDetails",
      );
      const buildingDetailsSnap = await getDoc(buildingDetailsRef);

      if (buildingDetailsSnap.exists()) {
        return buildingDetailsSnap.data();
      }

      return null;
    } catch (error) {
      console.error("Error getting building details:", error);
      throw error;
    }
  }

  /**
   * Get active status for assets on a floor plan
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @returns {Promise<object>} - Active statuses by asset ID
   */
  /**
   * Get active status for assets on a floor plan
   * Fetches from both legacy assetMappings subcollection and new asset/{category}/ collections
   * @param {string} buildingName - Building name (with BuildingDB suffix)
   * @param {string} floorPlanName - Floor plan name
   * @returns {Promise<object>} - { activeStatuses, timestamp }
   */
  static async getActiveStatus(buildingName, floorPlanName) {
    try {
      const categoryKeys = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "elv",
        "security",
        "vertical-transport",
        "lighting",
        "bms",
        "landscaping",
        "additional",
      ];

      const activeStatuses = {};

      // 1. Fetch from legacy assetMappings subcollection (for backward compatibility)
      try {
        const mappingsRef = collection(
          db,
          buildingName,
          "floorMaps",
          "floors",
          floorPlanName,
          "assetMappings",
        );
        const snapshot = await getDocs(mappingsRef);

        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          const assetId = data.id || docSnapshot.id;
          activeStatuses[assetId] = {
            active: data.active || 0,
            activityStatus:
              data.activityStatus !== undefined ? data.activityStatus : 1,
            enabled: data.enabled !== undefined ? data.enabled : true,
            installed: data.installed || false,
            lastUpdated: new Date().toISOString(),
          };
        });
      } catch (error) {
        console.error("Error fetching legacy assetMappings:", error);
        // Continue to try new structure
      }

      // 2. Fetch from asset/{category}/ collections that have matching floorName (new structure)
      for (const categoryKey of categoryKeys) {
        try {
          const categoryCollection = collection(
            db,
            buildingName,
            "asset",
            categoryKey,
          );
          const categorySnapshot = await getDocs(categoryCollection);

          categorySnapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data();

            // Only include assets that are placed on this floor
            if (
              data.floorPlanName === floorPlanName &&
              typeof data.x === "number" &&
              typeof data.y === "number"
            ) {
              const assetId = data.buildingAssetId || docSnapshot.id;

              activeStatuses[assetId] = {
                active: data.active || 0,
                activityStatus:
                  data.activityStatus !== undefined ? data.activityStatus : 1,
                enabled: data.enabled !== undefined ? data.enabled : true,
                installed: data.installed || false,
                lastUpdated: new Date().toISOString(),
              };
            }
          });
        } catch (error) {
          console.error(`Error fetching category ${categoryKey}:`, error);
          // Continue with other categories
        }
      }

      return {
        activeStatuses,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("Error getting active status:", error);
      throw error;
    }
  }
  // ==================== CONSTRUCTION MANAGEMENT ====================

  static async createOrUpdateConstructionStatus(
    buildingName,
    constructionPayload,
  ) {
    try {
      const ref = doc(db, "constructionDetails", buildingName);
      await setDoc(ref, constructionPayload, { merge: true });
      return { success: true, buildingName };
    } catch (error) {
      console.error(
        `Error creating/updating construction status for ${buildingName}:`,
        error,
      );
      throw error;
    }
  }

  static async getConstructionStatus(buildingName) {
    try {
      const ref = doc(db, "constructionDetails", buildingName);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data();
    } catch (error) {
      console.error(
        `Error getting construction status for ${buildingName}:`,
        error,
      );
      throw error;
    }
  }

  static async getAllConstructionStatuses() {
    try {
      const col = collection(db, "constructionDetails");
      const snaps = await getDocs(col);
      const results = [];
      snaps.forEach((d) => results.push({ buildingName: d.id, ...d.data() }));
      return results;
    } catch (error) {
      console.error("Error getting all construction statuses:", error);
      throw error;
    }
  }

  /**
   * Create building skeleton documents (client helper)
   * Ensures alarmMessage document uses `alarmMessage` field (array) instead of `messages`
   *
   * All docs go in one writeBatch so we only rewrite the local DB once
   * (important when AssetsList is large).
   */
  static async createBuildingSkeleton(buildingName) {
    try {
      const collectionName = `${buildingName}BuildingDB`;
      const now = new Date();
      const batch = writeBatch(db);

      batch.set(
        doc(db, collectionName, "actions"),
        {
          ack: false,
          live: false,
          ppm: false,
          reset: false,
          sack: false,
          silence: false,
          tack: false,
        },
        { merge: true },
      );

      // IMPORTANT: use `alarmMessage` (array), not legacy `messages`
      batch.set(
        doc(db, collectionName, "alarmMessage"),
        {
          alarmMessage: [],
          // Clear any leftover legacy field in the same write
          messages: deleteField(),
        },
        { merge: true },
      );

      batch.set(
        doc(db, collectionName, "alarmDetails"),
        {
          totalFire: 0,
          totalSupervisory: 0,
          totalTrouble: 0,
        },
        { merge: true },
      );

      batch.set(
        doc(db, collectionName, "buildingDetails"),
        {
          buildingName: buildingName,
          floorDetails: "",
          locationData: "",
          mapData: "",
          operator: "",
          communityId: null,
          communityName: "Not Assigned",
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      batch.set(
        doc(db, collectionName, "contactDetails"),
        {
          contactName: "",
          contactNo: [],
          contactPosition: "",
          emailId: "",
        },
        { merge: true },
      );

      batch.set(
        doc(db, collectionName, "projectDetails"),
        {
          clientName: "",
          contractorName: "",
          projectName: "",
        },
        { merge: true },
      );

      batch.set(doc(db, collectionName, "mimic"), {}, { merge: true });
      batch.set(
        doc(db, collectionName, "mimicMap"),
        { mimicDetails: {} },
        { merge: true },
      );
      batch.set(
        doc(db, collectionName, "smokeActions"),
        { SEF: true, SPF: true, LIFT: true, FAN: true },
        { merge: true },
      );

      await batch.commit();
      return { success: true, buildingName };
    } catch (error) {
      console.error("Error creating building skeleton:", error);
      throw error;
    }
  }

  /**
   * Get smoke action flags for a building
   * @param {string} buildingName - Building name (without suffix)
   * @returns {Promise<object|null>} - { FAN, LIFT, SEF, SPF } or null
   */
  static async getSmokeActions(buildingName) {
    try {
      const collectionName = `${buildingName}BuildingDB`;
      const ref = doc(db, collectionName, "smokeActions");
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data() || null;
    } catch (error) {
      console.error(`Error getting smokeActions for ${buildingName}:`, error);
      throw error;
    }
  }

  /**
   * Update smoke action flags for a building
   * @param {string} buildingName - Building name (without suffix)
   * @param {object} updates - Partial object with keys FAN/LIFT/SEF/SPF
   * @returns {Promise<object>} - updated data
   */
  static async updateSmokeActions(buildingName, updates) {
    try {
      const collectionName = `${buildingName}BuildingDB`;
      const ref = doc(db, collectionName, "smokeActions");
      await setDoc(ref, updates, { merge: true });
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    } catch (error) {
      console.error(`Error updating smokeActions for ${buildingName}:`, error);
      throw error;
    }
  }

  static async updateConstructionStep(
    buildingName,
    stepName,
    stepValue,
    updatedBy = "system",
  ) {
    try {
      const ref = doc(db, "constructionDetails", buildingName);
      const snap = await getDoc(ref);
      let data = {};
      if (snap.exists()) data = snap.data();
      if (!data.constructionStatus) data.constructionStatus = {};
      data.constructionStatus[stepName] = stepValue;
      data.lastUpdated = new Date();
      data.updatedBy = updatedBy;
      // Recalculate overall progress
      const statusValues = Object.values(data.constructionStatus);
      const completedCount = statusValues.filter((s) => s === 1).length;
      data.overallProgress = {
        completed: completedCount,
        ongoing: statusValues.filter((s) => s === 0).length,
        yetToStart: statusValues.filter((s) => s === -1).length,
        totalSteps: statusValues.length,
        completionPercentage: Math.round(
          (completedCount / statusValues.length) * 100,
        ),
      };
      await setDoc(ref, data, { merge: true });
      return { success: true, buildingName };
    } catch (error) {
      console.error(
        `Error updating construction step for ${buildingName}:`,
        error,
      );
      throw error;
    }
  }

  static async deleteConstructionStatus(buildingName) {
    try {
      const ref = doc(db, "constructionDetails", buildingName);
      await deleteDoc(ref);
      return { success: true, buildingName };
    } catch (error) {
      console.error(
        `Error deleting construction status for ${buildingName}:`,
        error,
      );
      throw error;
    }
  }

  // ==================== SUBCATEGORY CONSTRUCTION ====================

  static async createOrUpdateSubcategoryConstruction(
    buildingName,
    categoryKey,
    subcategoryName,
    payload,
  ) {
    try {
      const docId = `${categoryKey}_${subcategoryName}`;
      const ref = doc(
        db,
        "subcategoryConstruction",
        buildingName,
        "subcategories",
        docId,
      );
      await setDoc(ref, payload, { merge: true });
      return { success: true, buildingName, categoryKey, subcategoryName };
    } catch (error) {
      console.error("Error creating/updating subcategory construction:", error);
      throw error;
    }
  }

  static async getSubcategoryConstruction(
    buildingName,
    categoryKey,
    subcategoryName,
  ) {
    try {
      const docId = `${categoryKey}_${subcategoryName}`;
      const ref = doc(
        db,
        "subcategoryConstruction",
        buildingName,
        "subcategories",
        docId,
      );
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data();
    } catch (error) {
      console.error("Error getting subcategory construction:", error);
      throw error;
    }
  }

  static async getAllSubcategoryConstructions(buildingName) {
    try {
      const col = collection(
        db,
        "subcategoryConstruction",
        buildingName,
        "subcategories",
      );
      const snaps = await getDocs(col);
      const results = [];
      snaps.forEach((d) => results.push({ id: d.id, ...d.data() }));
      return results;
    } catch (error) {
      console.error("Error getting all subcategory constructions:", error);
      throw error;
    }
  }

  static async listSubcategories(buildingName) {
    try {
      const ASSET_CATEGORIES_KEYS = [
        "fire-life-safety",
        "electrical",
        "hvac",
        "plumbing",
        "elv",
        "security",
        "vertical-transport",
        "lighting",
        "bms",
        "landscaping",
        "additional",
      ];
      const subcategories = [];
      for (const categoryKey of ASSET_CATEGORIES_KEYS) {
        try {
          const categoryPath = `${buildingName}/asset/${categoryKey}`;
          const categoryCollection = collection(db, categoryPath);
          const snapshot = await getDocs(categoryCollection);
          if (!snapshot.empty) {
            const seen = new Set();
            snapshot.forEach((docSnap) => {
              const assetData = docSnap.data();
              if (assetData.subCategory && !seen.has(assetData.subCategory)) {
                seen.add(assetData.subCategory);
                subcategories.push({
                  subcategoryName: assetData.subCategory,
                  categoryKey,
                });
              }
            });
          }
        } catch (err) {
          console.warn(`Error querying category ${categoryKey}:`, err.message);
        }
      }
      return subcategories;
    } catch (error) {
      console.error("Error listing subcategories:", error);
      throw error;
    }
  }

  // ==================== COMMUNITY MANAGEMENT ====================

  static async createCommunity(communityData) {
    try {
      const communitiesRef = collection(db, "communities");
      const res = await communitiesRef.add({
        ...communityData,
        buildings: communityData.buildings || [],
        totalBuildings: (communityData.buildings || []).length,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: communityData.isActive ?? true,
      });
      return { id: res.id, ...communityData };
    } catch (error) {
      console.error("Error creating community:", error);
      throw error;
    }
  }

  static async getCommunityById(communityId) {
    try {
      const ref = doc(db, "communities", communityId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (error) {
      console.error("Error getting community by id:", error);
      throw error;
    }
  }

  static async updateCommunity(communityId, updates) {
    try {
      const ref = doc(db, "communities", communityId);
      await updateDoc(ref, { ...updates, updatedAt: new Date() });
      const updated = await getDoc(ref);
      return { id: updated.id, ...updated.data() };
    } catch (error) {
      console.error("Error updating community:", error);
      throw error;
    }
  }

  static async deleteCommunity(communityId) {
    try {
      const ref = doc(db, "communities", communityId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { success: false, message: "Not found" };
      const data = snap.data();
      if (data.buildings && data.buildings.length > 0) {
        return {
          success: false,
          message: "Community has assigned buildings",
          assignedBuildings: data.buildings,
        };
      }
      await deleteDoc(ref);
      return { success: true, communityId };
    } catch (error) {
      console.error("Error deleting community:", error);
      throw error;
    }
  }

  static async assignBuildingsToCommunity(
    communityId,
    buildings,
    updatedBy = "system",
  ) {
    try {
      const communityRef = doc(db, "communities", communityId);
      const communitySnap = await getDoc(communityRef);
      if (!communitySnap.exists()) throw new Error("Community not found");
      const communityData = communitySnap.data();
      const allBuildings = Array.from(
        new Set([...(communityData.buildings || []), ...buildings]),
      );
      await updateDoc(communityRef, {
        buildings: allBuildings,
        totalBuildings: allBuildings.length,
        updatedAt: new Date(),
        updatedBy,
      });
      // Update building documents' buildingDetails
      const promises = buildings.map(async (b) => {
        const colName = `${b}BuildingDB`;
        try {
          const buildingDetailsRef = doc(db, colName, "buildingDetails");
          const buildingSnap = await getDoc(buildingDetailsRef);
          if (!buildingSnap.exists())
            throw new Error(`Building ${b} does not exist`);
          await updateDoc(buildingDetailsRef, {
            communityId,
            communityName: communityData.communityName,
            updatedAt: new Date(),
          });
          return { buildingName: b, success: true };
        } catch (err) {
          return { buildingName: b, success: false, error: err.message };
        }
      });
      const results = await Promise.all(promises);
      return { success: true, communityId, results };
    } catch (error) {
      console.error("Error assigning buildings to community:", error);
      throw error;
    }
  }

  static async removeBuildingsFromCommunity(
    communityId,
    buildings,
    updatedBy = "system",
  ) {
    try {
      const communityRef = doc(db, "communities", communityId);
      const communitySnap = await getDoc(communityRef);
      if (!communitySnap.exists()) throw new Error("Community not found");
      const currentBuildings = communitySnap.data().buildings || [];
      const removeSet = new Set(
        buildings
          .map((b) => this.normalizeBuildingNameForUserDoc(String(b)))
          .filter(Boolean),
      );
      const remaining = currentBuildings.filter((b) => {
        const norm = this.normalizeBuildingNameForUserDoc(String(b));
        return !removeSet.has(norm);
      });
      await updateDoc(communityRef, {
        buildings: remaining,
        totalBuildings: remaining.length,
        updatedAt: new Date(),
        updatedBy,
      });
      // Remove community info from each building
      const promises = [...removeSet].map(async (short) => {
        const colName = `${short}BuildingDB`;
        try {
          const buildingDetailsRef = doc(db, colName, "buildingDetails");
          const buildingSnap = await getDoc(buildingDetailsRef);
          if (buildingSnap.exists()) {
            await updateDoc(buildingDetailsRef, {
              communityId: null,
              communityName: "Not Assigned",
              updatedAt: new Date(),
            });
          }
          return { buildingName: short, success: true };
        } catch (err) {
          return { buildingName: short, success: false, error: err.message };
        }
      });
      const results = await Promise.all(promises);
      return { success: true, communityId, results };
    } catch (error) {
      console.error("Error removing buildings from community:", error);
      throw error;
    }
  }

  static async _deleteStorageFolderRecursive(folderRef) {
    try {
      const list = await listAll(folderRef);
      await Promise.all(list.items.map((itemRef) => deleteObject(itemRef)));
      await Promise.all(
        list.prefixes.map((prefixRef) =>
          FirestoreService._deleteStorageFolderRecursive(prefixRef),
        ),
      );
    } catch (e) {
      console.warn("Storage folder delete:", e?.message || e);
    }
  }

  static async _commitDeletesInBatches(refs) {
    const chunkSize = 450;
    for (let i = 0; i < refs.length; i += chunkSize) {
      const batch = writeBatch(db);
      refs.slice(i, i + chunkSize).forEach((r) => batch.delete(r));
      await batch.commit();
    }
  }

  /**
   * Remove a building id from every user in UserDB and MailDB (array or per-community object).
   */
  static async removeBuildingFromAllUsers(shortName) {
    const norm = this.normalizeBuildingNameForUserDoc(shortName);
    for (const colName of ["UserDB", "MailDB"]) {
      try {
        const snap = await getDocs(collection(db, colName));
        for (const userDoc of snap.docs) {
          const data = userDoc.data();
          const b = data.buildings;
          if (b === undefined || b === null) continue;
          let next;
          let changed = false;
          if (Array.isArray(b)) {
            const filtered = b.filter(
              (x) => this.normalizeBuildingNameForUserDoc(String(x)) !== norm,
            );
            if (filtered.length === b.length) continue;
            next = filtered;
            changed = true;
          } else if (typeof b === "object") {
            next = { ...b };
            for (const k of Object.keys(next)) {
              const arr = Array.isArray(next[k]) ? next[k] : [];
              const filtered = arr.filter(
                (x) => this.normalizeBuildingNameForUserDoc(String(x)) !== norm,
              );
              if (filtered.length !== arr.length) changed = true;
              next[k] = filtered;
            }
            if (!changed) continue;
          } else {
            continue;
          }
          await updateDoc(userDoc.ref, { buildings: next });
        }
      } catch (e) {
        console.error(`removeBuildingFromAllUsers (${colName}):`, e);
      }
    }
  }

  /**
   * Delete a building: remove from its community, strip from all users, then delete
   * `{name}BuildingDB` documents (floor maps, assets, alarms, etc.), related root docs,
   * optional FloorMaps mirror, storage prefix, and notification configs.
   * @param {string} rawBuildingName - Short name or with BuildingDB suffix
   */
  static async deleteBuildingCompletely(rawBuildingName) {
    const short = this.normalizeBuildingNameForUserDoc(rawBuildingName);
    if (!short) {
      return { success: false, message: "Invalid building name." };
    }
    const dbName = `${short}BuildingDB`;
    const warnings = [];

    const assetCategoryKeys = [
      "fire-life-safety",
      "electrical",
      "hvac",
      "plumbing",
      "elv",
      "security",
      "vertical-transport",
      "lighting",
      "bms",
      "landscaping",
      "additional",
    ];
    const legacyAssetLeafDocs = [
      ["civil", "civil"],
      ["electrical", "electrical"],
      ["mech", "mech"],
      ["plumbing", "plumbing"],
    ];

    try {
      const bdRef = doc(db, dbName, "buildingDetails");
      const bdSnap = await getDoc(bdRef);
      const communityId =
        bdSnap.exists() && bdSnap.data().communityId
          ? bdSnap.data().communityId
          : null;

      if (communityId) {
        try {
          await this.removeBuildingsFromCommunity(
            communityId,
            [short],
            "delete-building",
          );
        } catch (e) {
          warnings.push(`Community: ${e.message}`);
        }
      }

      try {
        await this.removeBuildingFromAllUsers(short);
      } catch (e) {
        warnings.push(`Users: ${e.message}`);
      }

      try {
        await deleteDoc(doc(db, "constructionDetails", short));
      } catch {
        /* optional doc */
      }

      try {
        await deleteDoc(doc(db, "buildingSummaries", short));
      } catch {
        /* optional doc */
      }

      try {
        await deleteDoc(doc(db, "assetsCollection", short));
      } catch {
        /* optional doc */
      }

      try {
        const subCol = collection(
          db,
          "subcategoryConstruction",
          short,
          "subcategories",
        );
        const subSnap = await getDocs(subCol);
        await this._commitDeletesInBatches(subSnap.docs.map((d) => d.ref));
      } catch (e) {
        warnings.push(`subcategoryConstruction: ${e.message}`);
      }

      try {
        const floorsCol = collection(db, dbName, "floorMaps", "floors");
        const floorsSnap = await getDocs(floorsCol);
        for (const fd of floorsSnap.docs) {
          try {
            await this.deleteFloorMap(dbName, fd.id);
          } catch (e) {
            warnings.push(`floorMap ${fd.id}: ${e.message}`);
          }
        }
        await deleteDoc(doc(db, dbName, "floorMaps")).catch(() => {});
      } catch (e) {
        warnings.push(`floorMaps (in BuildingDB): ${e.message}`);
      }

      try {
        const gcpFloorsCol = collection(db, "FloorMaps", short, "floors");
        const gcpFloorsSnap = await getDocs(gcpFloorsCol);
        const gcpRefs = [];
        for (const fdoc of gcpFloorsSnap.docs) {
          const mapCol = collection(
            db,
            "FloorMaps",
            short,
            "floors",
            fdoc.id,
            "assetMappings",
          );
          const mapSnap = await getDocs(mapCol);
          mapSnap.forEach((m) => gcpRefs.push(m.ref));
          gcpRefs.push(fdoc.ref);
        }
        await this._commitDeletesInBatches(gcpRefs);
        await deleteDoc(doc(db, "FloorMaps", short)).catch(() => {});
      } catch (e) {
        warnings.push(`FloorMaps (global): ${e.message}`);
      }

      for (const key of assetCategoryKeys) {
        try {
          const catCol = collection(db, dbName, "asset", key);
          const catSnap = await getDocs(catCol);
          await this._commitDeletesInBatches(catSnap.docs.map((d) => d.ref));
        } catch (e) {
          warnings.push(`asset/${key}: ${e.message}`);
        }
      }

      for (const [sub, leafId] of legacyAssetLeafDocs) {
        try {
          await deleteDoc(doc(db, dbName, "asset", sub, leafId));
        } catch {
          /* ignore */
        }
      }

      try {
        await deleteDoc(doc(db, dbName, "asset"));
      } catch {
        /* ignore */
      }

      const rootSnap = await getDocs(collection(db, dbName));
      await this._commitDeletesInBatches(rootSnap.docs.map((d) => d.ref));

      try {
        await this._deleteStorageFolderRecursive(
          ref(storage, `buildings/${short}`),
        );
      } catch (e) {
        warnings.push(`Storage: ${e.message}`);
      }

      try {
        const notifSnap = await getDocs(collection(db, "notifications"));
        for (const nd of notifSnap.docs) {
          const d = nd.data();
          const barr = d.buildings;
          if (!Array.isArray(barr) || !barr.length) continue;
          const norm = this.normalizeBuildingNameForUserDoc(short);
          const filtered = barr.filter(
            (x) => this.normalizeBuildingNameForUserDoc(String(x)) !== norm,
          );
          if (filtered.length !== barr.length) {
            await updateDoc(nd.ref, { buildings: filtered });
          }
        }
      } catch (e) {
        warnings.push(`notifications: ${e.message}`);
      }

      return {
        success: true,
        message: `Building "${short}" was deleted (Firestore, community, users, and related data).`,
        warnings: warnings.length ? warnings : undefined,
      };
    } catch (error) {
      console.error("deleteBuildingCompletely:", error);
      return {
        success: false,
        message: error.message || "Failed to delete building.",
      };
    }
  }

  /**
   * Normalize building id for UserDB/MailDB: collection id is "{name}BuildingDB", user docs store short "name".
   */
  static normalizeBuildingNameForUserDoc(name) {
    if (typeof name !== "string") return "";
    const t = name.trim();
    if (!t) return "";
    return t.endsWith("BuildingDB") ? t.slice(0, -"BuildingDB".length) : t;
  }

  static async _getBuildingCommunityId(shortName) {
    try {
      const ref = doc(db, `${shortName}BuildingDB`, "buildingDetails");
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const cid = snap.data().communityId;
      return cid || null;
    } catch {
      return null;
    }
  }

  /**
   * Merge new building short names into user.buildings (array or per-community object).
   */
  static async _mergeBuildingsForUser(userData, shortNamesToAdd) {
    const uniqueAdd = [
      ...new Set(
        shortNamesToAdd
          .map((n) => this.normalizeBuildingNameForUserDoc(n))
          .filter(Boolean),
      ),
    ];
    const normalizeList = (arr) =>
      [
        ...new Set(
          (arr || [])
            .map((b) => this.normalizeBuildingNameForUserDoc(String(b)))
            .filter(Boolean),
        ),
      ];

    const current = userData.buildings;

    if (current === undefined || current === null) {
      return uniqueAdd;
    }

    if (Array.isArray(current)) {
      return normalizeList([...current, ...uniqueAdd]);
    }

    if (typeof current === "object") {
      const next = { ...current };
      const userCommunities = Array.isArray(userData.communities)
        ? userData.communities
        : [];

      for (const shortName of uniqueAdd) {
        let targetKey = await this._getBuildingCommunityId(shortName);
        if (!targetKey && userCommunities.length > 0) {
          targetKey = userCommunities[0];
        }
        if (!targetKey) {
          const keys = Object.keys(next);
          targetKey = keys.length > 0 ? keys[0] : null;
        }
        if (!targetKey) {
          return normalizeList([...Object.values(next).flat(), ...uniqueAdd]);
        }

        const existing = Array.isArray(next[targetKey]) ? next[targetKey] : [];
        next[targetKey] = normalizeList([...existing, shortName]);
      }
      return next;
    }

    return uniqueAdd;
  }

  /**
   * Assign buildings to a user by email in both UserDB and MailDB (backend /building/assign/v2 only updates MailDB).
   * Merges with existing assignments; does not replace the whole buildings field.
   */
  static async assignBuildingsToUserByEmail(userEmail, rawBuildingNames) {
    const email = userEmail.trim();
    const shortNames = [
      ...new Set(
        (rawBuildingNames || []).map((b) =>
          this.normalizeBuildingNameForUserDoc(b),
        ),
      ),
    ].filter(Boolean);

    if (!email || shortNames.length === 0) {
      return {
        success: false,
        message: "Email and at least one building are required.",
      };
    }

    let updated = false;
    const errors = [];

    for (const colName of ["UserDB", "MailDB"]) {
      try {
        const cref = collection(db, colName);
        const q = query(cref, where("email", "==", email));
        const snap = await getDocs(q);
        if (snap.empty) continue;

        const docSnap = snap.docs[0];
        const userData = docSnap.data();
        const newBuildings = await this._mergeBuildingsForUser(
          userData,
          shortNames,
        );
        await updateDoc(docSnap.ref, { buildings: newBuildings });
        updated = true;
      } catch (e) {
        console.error(`assignBuildingsToUserByEmail (${colName}):`, e);
        errors.push(`${colName}: ${e.message}`);
      }
    }

    if (!updated) {
      return {
        success: false,
        message:
          "User not found in UserDB or MailDB. Add the user from Manage Users first, or verify the email matches exactly.",
        errors,
      };
    }

    return { success: true, message: "Buildings assigned successfully." };
  }

  /**
   * Remove building short names from user.buildings (array or per-community object).
   */
  static _removeBuildingsFromUser(userData, shortNamesToRemove) {
    const removeSet = new Set(
      shortNamesToRemove
        .map((n) => this.normalizeBuildingNameForUserDoc(n))
        .filter(Boolean),
    );
    const keep = (b) =>
      !removeSet.has(this.normalizeBuildingNameForUserDoc(String(b)));

    const current = userData.buildings;
    if (current === undefined || current === null) {
      return [];
    }
    if (Array.isArray(current)) {
      return current.filter(keep);
    }
    if (typeof current === "object") {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        const arr = Array.isArray(next[key]) ? next[key] : [];
        next[key] = arr.filter(keep);
      }
      return next;
    }
    return [];
  }

  /**
   * Unassign buildings from a user by email (UserDB and MailDB when present).
   */
  static async unassignBuildingsFromUserByEmail(userEmail, rawBuildingNames) {
    const email = userEmail.trim();
    const shortNames = [
      ...new Set(
        (rawBuildingNames || []).map((b) =>
          this.normalizeBuildingNameForUserDoc(b),
        ),
      ),
    ].filter(Boolean);

    if (!email || shortNames.length === 0) {
      return {
        success: false,
        message: "Email and at least one building are required.",
      };
    }

    let updated = false;
    const errors = [];

    for (const colName of ["UserDB", "MailDB"]) {
      try {
        const cref = collection(db, colName);
        const q = query(cref, where("email", "==", email));
        const snap = await getDocs(q);
        if (snap.empty) continue;

        const docSnap = snap.docs[0];
        const userData = docSnap.data();
        const newBuildings = this._removeBuildingsFromUser(
          userData,
          shortNames,
        );
        await updateDoc(docSnap.ref, { buildings: newBuildings });
        updated = true;
      } catch (e) {
        console.error(`unassignBuildingsFromUserByEmail (${colName}):`, e);
        errors.push(`${colName}: ${e.message}`);
      }
    }

    if (!updated) {
      return {
        success: false,
        message:
          "User not found in UserDB or MailDB. Verify the email matches exactly.",
        errors,
      };
    }

    return { success: true, message: "Building unassigned successfully." };
  }

  /**
   * List assigned building short names for a user (first match: UserDB, then MailDB).
   */
  static async getUserAssignedBuildingShortNames(userEmail) {
    const email = userEmail.trim();
    if (!email) return [];

    const extract = (userData) => {
      const raw = userData.buildings;
      let names = [];
      if (Array.isArray(raw)) names = raw;
      else if (raw && typeof raw === "object") names = Object.values(raw).flat();
      else names = [];
      return [
        ...new Set(
          names
            .map((b) => this.normalizeBuildingNameForUserDoc(String(b)))
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    };

    for (const colName of ["UserDB", "MailDB"]) {
      try {
        const q = query(collection(db, colName), where("email", "==", email));
        const snap = await getDocs(q);
        if (!snap.empty) return extract(snap.docs[0].data());
      } catch (e) {
        console.error(`getUserAssignedBuildingShortNames (${colName}):`, e);
      }
    }
    return [];
  }

  static async getBuildingsWithCommunityStatus(email) {
    try {
      const userRef = collection(db, "UserDB");
      const q = query(userRef, where("email", "==", email));
      const snap = await getDocs(q);
      if (snap.empty) throw new Error("User not found");
      const user = snap.docs[0].data();
      let buildingNames = [];
      if (user.role === "admin") {
        const ids = await this._safeListCollectionIds();
        if (!ids || ids.length === 0) {
          console.warn(
            "No collection ids available; returning empty building list for admin.",
          );
          buildingNames = [];
        } else {
          buildingNames = ids
            .filter((n) => n.endsWith("BuildingDB") || n === "areej5")
            .map((n) => n.replace("BuildingDB", ""));
        }
      } else {
        const raw = user.buildings;
        if (Array.isArray(raw)) {
          buildingNames = raw;
        } else if (raw && typeof raw === "object") {
          buildingNames = Object.values(raw).flat();
        } else {
          buildingNames = [];
        }
      }
      const normalizedNames = [
        ...new Set(
          buildingNames
            .map((b) => this.normalizeBuildingNameForUserDoc(String(b)))
            .filter(Boolean),
        ),
      ];
      const results = await Promise.all(
        normalizedNames.map(async (short) => {
          try {
            const colName = `${short}BuildingDB`;
            const buildingDetailsRef = doc(db, colName, "buildingDetails");
            const bsnap = await getDoc(buildingDetailsRef);
            if (bsnap.exists()) {
              const data = bsnap.data();
              return {
                buildingName: short,
                communityId: data.communityId || null,
                communityName: data.communityName || "Not Assigned",
                ...data,
              };
            }
            return {
              buildingName: short,
              communityId: null,
              communityName: "Not Assigned",
            };
          } catch (err) {
            return {
              buildingName: short,
              communityId: null,
              communityName: "Not Assigned",
            };
          }
        }),
      );
      return results;
    } catch (error) {
      console.error("Error getting buildings with community status:", error);
      throw error;
    }
  }

  static async getUnassignedBuildings() {
    try {
      const ids = await this._safeListCollectionIds();
      if (!ids || ids.length === 0) {
        console.warn(
          "No collection ids available; getUnassignedBuildings will return [].",
        );
        return [];
      }
      const buildingCollectionNames = ids.filter(
        (n) => n.endsWith("BuildingDB") || n === "areej5",
      );
      const unassigned = [];
      for (const colName of buildingCollectionNames) {
        try {
          const refDetails = doc(db, colName, "buildingDetails");
          const snap = await getDoc(refDetails);
          if (snap.exists()) {
            const data = snap.data();
            if (!data.communityId) {
              unassigned.push({
                buildingName: colName.replace("BuildingDB", ""),
                communityName: data.communityName || "Not Assigned",
                ...data,
              });
            }
          }
        } catch (err) {
          console.warn(`Error checking building ${colName}:`, err.message);
        }
      }
      return unassigned;
    } catch (error) {
      console.error("Error getting unassigned buildings:", error);
      throw error;
    }
  }

  static async getCommunityBuildings(communityId) {
    try {
      const communityRef = doc(db, "communities", communityId);
      const cSnap = await getDoc(communityRef);
      if (!cSnap.exists()) return [];
      const communityData = cSnap.data();
      const buildingNames = communityData.buildings || [];
      const results = await Promise.all(
        buildingNames.map(async (b) => {
          try {
            const colName = `${b}BuildingDB`;
            const ref = doc(db, colName, "buildingDetails");
            const snap = await getDoc(ref);
            if (snap.exists()) return { buildingName: b, ...snap.data() };
            return { buildingName: b };
          } catch (err) {
            return { buildingName: b };
          }
        }),
      );
      return results;
    } catch (error) {
      console.error("Error getting community buildings:", error);
      throw error;
    }
  }

  // ==================== INCIDENT MANAGEMENT ====================

  static async getIncidentsForBuilding(buildingName) {
    try {
      const ref = doc(db, `${buildingName}`, "incidents");
      const snap = await getDoc(ref);
      if (!snap.exists()) return [];
      const data = snap.data();
      return data.incidents || [];
    } catch (error) {
      console.error("Error getting incidents for building:", error);
      throw error;
    }
  }

  static async getAllIncidents() {
    try {
      const ids = await this._safeListCollectionIds();
      if (!ids || ids.length === 0) {
        console.warn(
          "No collection ids available; getAllIncidents will return []",
        );
        return [];
      }
      const buildingIncidentsPromises = ids
        .filter((id) => id.endsWith("BuildingDB") || id === "areej5")
        .map(async (id) => {
          const incidentsRef = doc(db, id, "incidents");
          const snap = await getDoc(incidentsRef);
          const incidents = snap.exists() ? snap.data().incidents || [] : [];
          return {
            buildingName: id,
            incidents,
            total: incidents.length,
            status: snap.exists(),
          };
        });
      const results = await Promise.all(buildingIncidentsPromises);
      return results;
    } catch (error) {
      console.error("Error getting all incidents:", error);
      throw error;
    }
  }

  static async addIncident(buildingName, incident) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "incidents");
      const snap = await getDoc(ref);
      const incidentId = `V365-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`;
      const newIncident = {
        ...incident,
        incidentId,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
      if (snap.exists()) {
        const data = snap.data();
        const incidents = data.incidents || [];
        incidents.push(newIncident);
        await updateDoc(ref, { incidents });
      } else {
        await setDoc(ref, { incidents: [newIncident] });
      }
      return { success: true, incidentId };
    } catch (error) {
      console.error("Error adding incident:", error);
      throw error;
    }
  }

  static async updateIncident(buildingName, incidentId, updates, updatedBy) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "incidents");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Incidents document not found");
      const incidents = snap.data().incidents || [];
      const idx = incidents.findIndex((inc) => inc.incidentId === incidentId);
      if (idx === -1) throw new Error("Incident not found");
      incidents[idx] = {
        ...incidents[idx],
        ...updates,
        lastUpdated: new Date().toISOString(),
        updatedBy,
      };
      await updateDoc(ref, { incidents });
      return { success: true, incidentId };
    } catch (error) {
      console.error("Error updating incident:", error);
      throw error;
    }
  }

  static async initializeSampleIncidents(buildingName, sampleIncidents) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "incidents");
      await setDoc(ref, { incidents: sampleIncidents });
      return { success: true, count: sampleIncidents.length };
    } catch (error) {
      console.error("Error initializing sample incidents:", error);
      throw error;
    }
  }

  // ==================== LIFECYCLE CHECKLIST ====================

  static async getLifecycleChecklist(buildingName) {
    try {
      const ref = doc(db, `${buildingName}`, "lifecycle-checklist");
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data().checklist || [];
    } catch (error) {
      console.error("Error getting lifecycle checklist:", error);
      throw error;
    }
  }

  static async getAllLifecycleChecklists() {
    try {
      const ids = await this._safeListCollectionIds();
      if (!ids || ids.length === 0) {
        console.warn(
          "No collection ids available; getAllLifecycleChecklists will return [].",
        );
        return [];
      }
      const promises = ids
        .filter((id) => id.endsWith("BuildingDB") || id === "areej5")
        .map(async (id) => {
          const ref = doc(db, id, "lifecycle-checklist");
          const snap = await getDoc(ref);
          return {
            buildingName: id,
            checklist: snap.exists() ? snap.data().checklist || [] : [],
            status: snap.exists(),
          };
        });
      return await Promise.all(promises);
    } catch (error) {
      console.error("Error getting all lifecycle checklists:", error);
      throw error;
    }
  }

  static async initializeLifecycleChecklist(
    buildingName,
    checklistWithMetadata,
  ) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "lifecycle-checklist");
      await setDoc(ref, {
        checklist: checklistWithMetadata,
        createdAt: new Date().toISOString(),
        createdBy: checklistWithMetadata[0]?.createdBy || "system",
        buildingName,
      });
      return { success: true, count: checklistWithMetadata.length };
    } catch (error) {
      console.error("Error initializing lifecycle checklist:", error);
      throw error;
    }
  }

  static async updateLifecycleTask(buildingName, taskId, updates) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "lifecycle-checklist");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Lifecycle checklist not found");
      const checklist = snap.data().checklist || [];
      const idx = checklist.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new Error("Task not found");
      checklist[idx] = {
        ...checklist[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(ref, { checklist });
      return checklist[idx];
    } catch (error) {
      console.error("Error updating lifecycle task:", error);
      throw error;
    }
  }

  static async addLifecycleTask(buildingName, task) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "lifecycle-checklist");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Lifecycle checklist not found");
      const checklist = snap.data().checklist || [];
      const taskId = `custom-${Date.now()}`;
      const maxOrder = Math.max(...checklist.map((t) => t.order || 0), 0);
      const newTask = {
        id: taskId,
        order: maxOrder + 1,
        ...task,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      checklist.push(newTask);
      await updateDoc(ref, { checklist });
      return newTask;
    } catch (error) {
      console.error("Error adding lifecycle task:", error);
      throw error;
    }
  }

  static async deleteLifecycleTask(buildingName, taskId) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "lifecycle-checklist");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Lifecycle checklist not found");
      const checklist = snap.data().checklist || [];
      const idx = checklist.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new Error("Task not found");
      const deleted = checklist.splice(idx, 1)[0];
      await updateDoc(ref, { checklist });
      return deleted;
    } catch (error) {
      console.error("Error deleting lifecycle task:", error);
      throw error;
    }
  }

  // ==================== FLS LIFECYCLE ====================

  static async getFlsLifecycle(buildingName) {
    try {
      const ref = doc(db, `${buildingName}`, "fls-lifecycle");
      const snap = await getDoc(ref);
      if (!snap.exists()) return [];
      return snap.data().lifecycle || [];
    } catch (error) {
      console.error("Error getting FLS lifecycle:", error);
      throw error;
    }
  }

  static async getAllFlsLifecycles() {
    try {
      const ids = await this._safeListCollectionIds();
      if (!ids || ids.length === 0) {
        console.warn(
          "No collection ids available; getAllFlsLifecycles will return [].",
        );
        return [];
      }
      const promises = ids
        .filter((id) => id.endsWith("BuildingDB") || id === "areej5")
        .map(async (id) => {
          const ref = doc(db, id, "fls-lifecycle");
          const snap = await getDoc(ref);
          return {
            buildingName: id,
            lifecycle: snap.exists() ? snap.data().lifecycle || [] : [],
            status: snap.exists(),
          };
        });
      return await Promise.all(promises);
    } catch (error) {
      console.error("Error getting all FLS lifecycles:", error);
      throw error;
    }
  }

  static async initializeFlsLifecycle(buildingName, flsWithMetadata) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "fls-lifecycle");
      await setDoc(ref, {
        lifecycle: flsWithMetadata,
        createdAt: new Date().toISOString(),
        createdBy: flsWithMetadata[0]?.createdBy || "system",
        buildingName,
      });
      return { success: true, count: flsWithMetadata.length };
    } catch (error) {
      console.error("Error initializing FLS lifecycle:", error);
      throw error;
    }
  }

  static async updateFlsTask(buildingName, taskId, updates) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "fls-lifecycle");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("FLS lifecycle not found");
      const lifecycle = snap.data().lifecycle || [];
      const idx = lifecycle.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new Error("Task not found");
      lifecycle[idx] = {
        ...lifecycle[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(ref, { lifecycle });
      return lifecycle[idx];
    } catch (error) {
      console.error("Error updating FLS task:", error);
      throw error;
    }
  }

  static async addFlsTask(buildingName, task) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "fls-lifecycle");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("FLS lifecycle not found");
      const lifecycle = snap.data().lifecycle || [];
      const taskId = `fls-custom-${Date.now()}`;
      const maxOrder = Math.max(...lifecycle.map((t) => t.order || 0), 0);
      const newTask = {
        id: taskId,
        order: maxOrder + 1,
        ...task,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      lifecycle.push(newTask);
      await updateDoc(ref, { lifecycle });
      return newTask;
    } catch (error) {
      console.error("Error adding FLS task:", error);
      throw error;
    }
  }

  static async deleteFlsTask(buildingName, taskId) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "fls-lifecycle");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("FLS lifecycle not found");
      const lifecycle = snap.data().lifecycle || [];
      const idx = lifecycle.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new Error("FLS task not found");
      const deleted = lifecycle.splice(idx, 1)[0];
      await updateDoc(ref, { lifecycle });
      return deleted;
    } catch (error) {
      console.error("Error deleting FLS task:", error);
      throw error;
    }
  }

  static async getFlsAnalytics(buildingName) {
    try {
      const lifecycle = await this.getFlsLifecycle(buildingName);
      const totalTasks = lifecycle.length;
      const completedTasks = lifecycle.filter(
        (t) => t.status === "Completed",
      ).length;
      const inProgressTasks = lifecycle.filter(
        (t) => t.status === "In Progress",
      ).length;
      const notStartedTasks = lifecycle.filter(
        (t) => t.status === "Not Started",
      ).length;
      const onHoldTasks = lifecycle.filter(
        (t) => t.status === "On Hold",
      ).length;
      const criticalPathTasks = lifecycle.filter((t) => t.criticalPath).length;
      const dcdRequiredTasks = lifecycle.filter((t) => t.dcdRequirement).length;
      const phases = [...new Set(lifecycle.map((t) => t.phase))];
      const phaseAnalytics = phases.map((phase) => {
        const phaseTasks = lifecycle.filter((t) => t.phase === phase);
        const phaseCompleted = phaseTasks.filter(
          (t) => t.status === "Completed",
        ).length;
        return {
          phase,
          total: phaseTasks.length,
          completed: phaseCompleted,
          percentage: Math.round((phaseCompleted / phaseTasks.length) * 100),
        };
      });
      const allSystems = lifecycle.flatMap((t) => t.systems || []);
      const uniqueSystems = [...new Set(allSystems)];
      const systemAnalytics = uniqueSystems.map((system) => {
        const systemTasks = lifecycle.filter(
          (t) => t.systems && t.systems.includes(system),
        );
        const systemCompleted = systemTasks.filter(
          (t) => t.status === "Completed",
        ).length;
        return {
          system,
          total: systemTasks.length,
          completed: systemCompleted,
          percentage: Math.round((systemCompleted / systemTasks.length) * 100),
        };
      });
      return {
        overview: {
          totalTasks,
          completedTasks,
          inProgressTasks,
          notStartedTasks,
          onHoldTasks,
          criticalPathTasks,
          dcdRequiredTasks,
          completionPercentage: Math.round(
            (completedTasks / Math.max(totalTasks, 1)) * 100,
          ),
        },
        phases: phaseAnalytics,
        systems: systemAnalytics,
      };
    } catch (error) {
      console.error("Error computing FLS analytics:", error);
      throw error;
    }
  }

  // ==================== CAUSE & EFFECT MATRIX ====================

  static async getCauseEffectMatrix(buildingName) {
    try {
      const ref = doc(db, `${buildingName}`, "cause-effect-matrix");
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const data = snap.data();
      // reconstruct rawData if flattenedData exists
      if (data.flattenedData) {
        data.rawData = this.reconstructMatrixDataStatic(
          data.flattenedData,
          data.totalRows,
          data.totalColumns,
        );
      }
      return data;
    } catch (error) {
      console.error("Error getting cause-effect matrix:", error);
      throw error;
    }
  }

  static flattenMatrixDataStatic(rawData) {
    const flattened = {};
    rawData.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell !== undefined && cell !== null && cell !== "")
          flattened[`${r}_${c}`] = cell;
      });
    });
    return flattened;
  }

  static reconstructMatrixDataStatic(flattenedData, totalRows, totalColumns) {
    const raw = [];
    for (let i = 0; i < totalRows; i++)
      raw[i] = new Array(totalColumns).fill("");
    Object.entries(flattenedData).forEach(([k, v]) => {
      const [r, c] = k.split("_").map(Number);
      if (r < totalRows && c < totalColumns) raw[r][c] = v;
    });
    return raw;
  }

  static async uploadCauseEffectMatrix(buildingName, matrixData) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "cause-effect-matrix");
      await setDoc(ref, matrixData, { merge: true });
      return { success: true, buildingName };
    } catch (error) {
      console.error("Error uploading cause-effect matrix:", error);
      throw error;
    }
  }

  static async updateMatrixCell(
    buildingName,
    rowIndex,
    columnIndex,
    value,
    updatedBy,
  ) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "cause-effect-matrix");
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Matrix not found");
      const data = snap.data();
      const flattened = data.flattenedData || {};
      const key = `${rowIndex}_${columnIndex}`;
      if (value !== undefined && value !== "") flattened[key] = value;
      else delete flattened[key];
      const newTotalRows = Math.max(data.totalRows || 0, rowIndex + 1);
      const newTotalColumns = Math.max(data.totalColumns || 0, columnIndex + 1);
      await updateDoc(ref, {
        flattenedData: flattened,
        lastUpdated: new Date().toISOString(),
        updatedBy,
        totalRows: newTotalRows,
        totalColumns: newTotalColumns,
      });
      return { success: true };
    } catch (error) {
      console.error("Error updating matrix cell:", error);
      throw error;
    }
  }

  static async deleteCauseEffectMatrix(buildingName) {
    try {
      const collectionName =
        buildingName === "areej5" ? `${buildingName}BuildingDB` : buildingName;
      const ref = doc(db, collectionName, "cause-effect-matrix");
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        if (data.fileUrl) {
          // best-effort: skip deleting GCS file here; let caller handle
          console.log(
            "Matrix had fileUrl; file deletion should be handled by caller if required.",
          );
        }
      }
      await deleteDoc(ref);
      return { success: true };
    } catch (error) {
      console.error("Error deleting cause-effect matrix:", error);
      throw error;
    }
  }

  static async getMatrixDownloadUrl(buildingName) {
    try {
      const ref = doc(db, `${buildingName}`, "cause-effect-matrix");
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const data = snap.data();
      return { fileUrl: data.fileUrl || null, fileName: data.fileName || null };
    } catch (error) {
      console.error("Error getting matrix download url:", error);
      throw error;
    }
  }

  // ==================== NOTIFICATION MANAGEMENT ====================

  static async saveNotificationConfig(config) {
    try {
      const ref = collection(db, "notifications");
      const res = await ref.add({ ...config, timestamp: new Date() });
      return { success: true, id: res.id };
    } catch (error) {
      console.error("Error saving notification config:", error);
      throw error;
    }
  }

  static async getNotificationConfigs() {
    try {
      const ref = collection(db, "notifications");
      const snaps = await getDocs(query(ref, orderBy("timestamp", "desc")));
      const configs = snaps.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        timestamp:
          d.data().timestamp?.toDate?.()?.toISOString?.() || d.data().timestamp,
      }));
      return configs;
    } catch (error) {
      console.error("Error getting notification configs:", error);
      throw error;
    }
  }

  static async updateNotificationConfig(configId, updateData) {
    try {
      const ref = doc(db, "notifications", configId);
      await updateDoc(ref, { ...updateData, updatedAt: new Date() });
      const snap = await getDoc(ref);
      return { id: snap.id, ...snap.data() };
    } catch (error) {
      console.error("Error updating notification config:", error);
      throw error;
    }
  }

  static async deleteNotificationConfig(configId) {
    try {
      const ref = doc(db, "notifications", configId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { success: false };
      const data = snap.data();
      await deleteDoc(ref);
      return { success: true, deletedData: data };
    } catch (error) {
      console.error("Error deleting notification config:", error);
      throw error;
    }
  }
  // Helper to safely list collection ids (admin-only API may not be available in client SDK)
  static async _safeListCollectionIds() {
    if (typeof db.listCollections === "function") {
      const cols = await db.listCollections();
      return cols.map((c) => c.id);
    }
    console.warn(
      "db.listCollections is not available in this environment (client SDK). Returning []",
    );
    return [];
  }
  // ==================== ALARMS & MESSAGES HELPERS ====================

  static async listMessages(buildingNames = []) {
    try {
      let collections = [];
      if (Array.isArray(buildingNames) && buildingNames.length > 0) {
        collections = buildingNames.map((b) => `${b}BuildingDB`);
      } else {
        const ids = await this._safeListCollectionIds();
        if (ids.length === 0) {
          console.warn(
            "No collection ids available; listMessages requires buildingNames when running in client.",
          );
          return [];
        }
        collections = ids;
      }

      const promises = collections.map(async (colId) => {
        try {
          const messagesRef = doc(db, colId, "alarmMessage");
          const snap = await getDoc(messagesRef);
          return {
            buildingName: colId.replace(/BuildingDB$/, ""),
            messages: snap.exists()
              ? snap.data().alarmMessage || snap.data().messages || []
              : [],
            status: snap.exists(),
          };
        } catch (err) {
          return null;
        }
      });

      const results = await Promise.all(promises);
      return results
        .filter((r) => r && r.status)
        .map(({ buildingName, messages }) => ({ buildingName, messages }));
    } catch (error) {
      console.error("Error listing messages:", error);
      throw error;
    }
  }

  static async getAllAlarmDetails() {
    try {
      const ids = await this._safeListCollectionIds();
      if (ids.length === 0) {
        console.warn(
          "No collection ids available; getAllAlarmDetails() requires server-side SDK or will return [].",
        );
        return [];
      }
      const promises = ids
        .filter((id) => id.endsWith("BuildingDB"))
        .map(async (id) => {
          const ref = doc(db, id, "alarmDetails");
          const snap = await getDoc(ref);
          return {
            buildingName: id.replace(/BuildingDB$/, ""),
            alarmDetails: snap.exists() ? snap.data() : null,
            status: snap.exists(),
          };
        });
      const res = await Promise.all(promises);
      return res.filter((r) => r.status);
    } catch (error) {
      console.error("Error getting all alarm details:", error);
      throw error;
    }
  }

  static async getBuildingAlarmDetails(buildingName) {
    try {
      // Try both `{name}BuildingDB` and plain `name` collection names
      const tryCollections = [`${buildingName}BuildingDB`, buildingName];
      for (const col of tryCollections) {
        try {
          const ref = doc(db, col, "alarmDetails");
          const snap = await getDoc(ref);
          if (snap.exists()) return snap.data();
        } catch (err) {
          // continue to next option
        }
      }
      return null;
    } catch (error) {
      console.error(`Error getting alarm details for ${buildingName}:`, error);
      throw error;
    }
  }

  static async getLiveAlarm(buildingName) {
    try {
      // Try both `{name}BuildingDB` and plain `name` collection names
      const tryCollections = [`${buildingName}BuildingDB`, buildingName];
      let snap = null;
      for (const col of tryCollections) {
        try {
          const ref = doc(db, col, "liveAlarm");
          const s = await getDoc(ref);
          if (s.exists()) {
            snap = s;
            break;
          }
        } catch (err) {
          // continue
        }
      }
      if (!snap) return { buildingName, fireMessages: [], totalFireCount: 0 };
      const data = snap.data();
      console.log(
        `[FirestoreService.getLiveAlarm] found liveAlarm in collection for building='${buildingName}', data=`,
        data,
      );
      const fireMessages =
        data.liveAlarm || data.messages || data.alarmMessage || [];
      const formatted = (
        Array.isArray(fireMessages) ? fireMessages : [fireMessages]
      ).map((m) => ({
        message: m.message,
        time: m.time,
        formattedTime: new Date(m.time).toLocaleString(),
      }));
      return {
        buildingName,
        fireMessages: formatted,
        totalFireCount: formatted.length,
      };
    } catch (error) {
      console.error("Error getting live alarm:", error);
      throw error;
    }
  }

  static async getLiveTrouble(buildingName) {
    try {
      const tryCollections = [`${buildingName}BuildingDB`, buildingName];
      let snap = null;
      for (const col of tryCollections) {
        try {
          const ref = doc(db, col, "liveTrouble");
          const s = await getDoc(ref);
          if (s.exists()) {
            snap = s;
            break;
          }
        } catch (err) {
          // continue
        }
      }
      if (!snap)
        return { buildingName, troubleMessages: [], totalTroubleCount: 0 };
      const data = snap.data();
      console.log(
        `[FirestoreService.getLiveTrouble] found liveTrouble in collection for building='${buildingName}', data=`,
        data,
      );
      const troubleMessages = data.liveTrouble
        ? [data.liveTrouble]
        : data.messages || data.alarmMessage || [];
      const parsed = [];
      troubleMessages.forEach((msg) => {
        if (!msg || !msg.message) return;
        const lines = msg.message
          .split("\n")
          .filter((l) => l.trim().length > 0);
        lines.forEach((ln) => {
          if (ln.includes("TRBL*")) {
            parsed.push({
              message: ln.trim(),
              time: msg.time,
              formattedTime: new Date(msg.time).toLocaleString(),
            });
          }
        });
      });
      return {
        buildingName,
        troubleMessages: parsed,
        totalTroubleCount: parsed.length,
      };
    } catch (error) {
      console.error("Error getting live trouble:", error);
      throw error;
    }
  }

  static async getLiveSupervisory(buildingName) {
    try {
      const tryCollections = [`${buildingName}BuildingDB`, buildingName];
      let snap = null;
      for (const col of tryCollections) {
        try {
          const ref = doc(db, col, "liveSupervisory");
          const s = await getDoc(ref);
          if (s.exists()) {
            snap = s;
            break;
          }
        } catch (err) {
          // continue
        }
      }
      if (!snap)
        return {
          buildingName,
          supervisoryMessages: [],
          totalSupervisoryCount: 0,
        };
      const data = snap.data();
      console.log(
        `[FirestoreService.getLiveSupervisory] found liveSupervisory in collection for building='${buildingName}', data=`,
        data,
      );
      const messages =
        data.liveSupervisory || data.messages || data.alarmMessage || [];
      const formatted = (Array.isArray(messages) ? messages : [messages]).map(
        (m) => ({
          message: m.message,
          time: m.time,
          formattedTime: new Date(m.time).toLocaleString(),
        }),
      );
      return {
        buildingName,
        supervisoryMessages: formatted,
        totalSupervisoryCount: formatted.length,
      };
    } catch (error) {
      console.error("Error getting live supervisory:", error);
      throw error;
    }
  }

  static async getAlarmMessages(buildingName) {
    try {
      // Get alarm messages from alarmMessages / alarmMessage document
      const tryCollections = [`${buildingName}BuildingDB`, buildingName];
      let messagesArray = [];

      for (const col of tryCollections) {
        try {
          for (const docId of ["alarmMessages", "alarmMessage"]) {
            const alarmMessageRef = doc(db, col, docId);
            const snapshot = await getDoc(alarmMessageRef);

            if (!snapshot.exists()) continue;

            const data = snapshot.data();
            // Prefer the matching field, then common legacy shapes
            const messages =
              data[docId] || data.alarmMessages || data.alarmMessage || data.messages || [];

            if (Array.isArray(messages) && messages.length > 0) {
              messagesArray = messages.map((msg) => {
                if (typeof msg === "string") {
                  return {
                    message: msg,
                    time: Date.now(),
                    formattedTime: "N/A",
                  };
                }
                const timeRaw = msg?.time;
                const timeMs =
                  typeof timeRaw === "number"
                    ? timeRaw
                    : typeof timeRaw === "string"
                      ? Date.parse(timeRaw)
                      : NaN;
                const time = Number.isFinite(timeMs) ? timeMs : Date.now();
                return {
                  message: msg?.message || String(msg || ""),
                  time,
                  formattedTime: Number.isFinite(timeMs)
                    ? new Date(time).toLocaleString()
                    : "N/A",
                };
              });
              break;
            }
          }
          if (messagesArray.length > 0) break;
        } catch (err) {
          console.error(`Error accessing ${col}/alarmMessages:`, err);
        }
      }

      // Sort by time descending (newest first)
      messagesArray.sort((a, b) => b.time - a.time);

      return {
        buildingName,
        alarmMessages: messagesArray,
        totalCount: messagesArray.length,
      };
    } catch (error) {
      console.error("Error getting alarm messages:", error);
      return {
        buildingName,
        alarmMessages: [],
        totalCount: 0,
      };
    }
  }

  // ==================== BUILDING INFO / LOCATION ====================

  /**
   * Get building details (includes locationData string for Smart City map)
   * @param {string} buildingName - Building name (without BuildingDB suffix)
   * @returns {Promise<object|null>} - buildingDetails document data, or null if not found
   */
  static async getBuildingInfo(buildingName) {
    try {
      const dbName = buildingName.endsWith("BuildingDB")
        ? buildingName
        : `${buildingName}BuildingDB`;
      const detailsRef = doc(db, dbName, "buildingDetails");
      const snap = await getDoc(detailsRef);
      if (snap.exists()) {
        return snap.data();
      }
      return null;
    } catch (error) {
      console.error(
        `Error getting building details for ${buildingName}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Update buildingDetails using the add-building form contract.
   * @param {string} buildingName
   * @param {object} form
   * @param {{localImageUri?: File|null, imageMime?: string|null}} [imageOptions]
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async updateBuildingWithForm(buildingName, form, imageOptions = {}) {
    try {
      const shortName = this.normalizeBuildingNameForUserDoc(buildingName);
      if (!shortName) {
        return { success: false, message: "Building name is required." };
      }

      const normalizeText = (value) =>
        typeof value === "string" ? value.trim() : "";
      const toCleanPhoneArray = (value) => {
        const source = Array.isArray(value) ? value : [];
        const cleaned = source.map((item) => normalizeText(item)).filter(Boolean);
        return cleaned.length ? cleaned : [""];
      };
      const toContactDetails = (value = {}) => ({
        name: normalizeText(value.name),
        designation: normalizeText(value.designation),
        email: normalizeText(value.email),
        phoneNumbers: toCleanPhoneArray(value.phoneNumbers),
      });
      const toSystemBrands = (value) =>
        (Array.isArray(value) ? value : [])
          .map((entry) => ({
            category: normalizeText(entry?.category) || null,
            system: normalizeText(entry?.system),
            subsystem: normalizeText(entry?.subsystem) || null,
            subsubsystem: normalizeText(entry?.subsubsystem) || null,
            brandName: normalizeText(entry?.brandName),
            brandImageUrl: normalizeText(entry?.brandImageUrl) || null,
          }))
          .filter((entry) => entry.system && entry.brandName);

      const detailsRef = doc(db, `${shortName}BuildingDB`, "buildingDetails");
      const payload = {
        floorDetails: normalizeText(form?.floorDetails),
        location: normalizeText(form?.location),
        locationData: normalizeText(form?.locationData),
        mapData: normalizeText(form?.mapData),
        fmCompany: normalizeText(form?.fmCompany),
        flsOperator: normalizeText(form?.flsOperator),
        operator: normalizeText(form?.flsOperator || form?.operator),
        fmCompanyContactDetails: toContactDetails(form?.fmCompanyContactDetails),
        operatorDetails: toContactDetails(form?.operatorDetails),
        systemBrands: toSystemBrands(form?.systemBrandEntries),
        firstPpmDate: form?.firstPpmDate ?? null,
        updatedAt: new Date(),
      };

      if (imageOptions?.localImageUri) {
        const imageFile = imageOptions.localImageUri;
        const mimeType = normalizeText(imageOptions.imageMime || imageFile?.type);
        const extFromMime =
          mimeType && mimeType.includes("/")
            ? mimeType.split("/")[1]
            : "";
        const fileExt =
          normalizeText(imageFile?.name).split(".").pop() ||
          extFromMime ||
          "jpg";
        const storageRef = ref(
          storage,
          `buildings/${shortName}/buildingImage.${fileExt}`,
        );
        await uploadBytes(storageRef, imageFile);
        payload.buildingImage = await getDownloadURL(storageRef);
      }

      await setDoc(detailsRef, payload, { merge: true });
      return { success: true, message: "Building updated successfully." };
    } catch (error) {
      console.error("Error updating building with form:", error);
      return {
        success: false,
        message: error?.message || "Failed to update building details.",
      };
    }
  }

  /**
   * Set or update building locationData string in buildingDetails for the Smart City map.
   * @param {string} buildingName - Building name (without BuildingDB suffix)
   * @param {string} locationData - Location string e.g. "25.2048,55.2708"
   * @returns {Promise<void>}
   */
  static async updateBuildingLocation(buildingName, locationData) {
    try {
      const dbName = buildingName.endsWith("BuildingDB")
        ? buildingName
        : `${buildingName}BuildingDB`;
      const detailsRef = doc(db, dbName, "buildingDetails");
      await setDoc(
        detailsRef,
        { locationData, updatedAt: Date.now() },
        { merge: true },
      );
    } catch (error) {
      console.error(
        `Error updating building location for ${buildingName}:`,
        error,
      );
      throw error;
    }
  }
}

export default FirestoreService;
