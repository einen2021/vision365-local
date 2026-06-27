/**
 * Upload floor plan images into the local app data store (web + desktop).
 * Files are copied to {AppData}/floor-plans/{building}/ on the desktop server.
 */
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/config/firebase";

export function buildFloorPlanStoragePath(buildingNameWithSuffix, fileName) {
  return `floor-plans/${buildingNameWithSuffix}/${fileName}`;
}

/**
 * Copy the selected image file into app storage and return a /local/... URL.
 * @param {string} buildingNameWithSuffix - e.g. "Test buildingBuildingDB"
 * @param {string} floorPlanName
 * @param {File} imageFile
 * @returns {Promise<string>}
 */
export async function uploadFloorPlanImage(
  buildingNameWithSuffix,
  floorPlanName,
  imageFile,
) {
  const ext = (imageFile.name.split(".").pop() || "jpg").toLowerCase();
  const imageFileName = `${floorPlanName}_${Date.now()}.${ext}`;
  const storageRef = ref(
    storage,
    buildFloorPlanStoragePath(buildingNameWithSuffix, imageFileName),
  );
  await uploadBytes(storageRef, imageFile);
  return getDownloadURL(storageRef);
}
