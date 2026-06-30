import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/config/firebase";
import { normalizeAssetTypeKey } from "@/lib/assetIcons";

const SETTINGS_DOC = ["AppSettings", "assetTypeIcons"];

export async function loadAssetTypeIconOverrides() {
  const snap = await getDoc(doc(db, ...SETTINGS_DOC));
  if (!snap.exists()) return {};
  const data = snap.data();
  return data?.overrides && typeof data.overrides === "object" ? data.overrides : {};
}

export async function saveAssetTypeIconOverride(typeKey, iconUrl) {
  const normalized = normalizeAssetTypeKey(typeKey);
  if (!normalized) throw new Error("Asset type is required");

  const snap = await getDoc(doc(db, ...SETTINGS_DOC));
  const current = snap.exists() ? snap.data()?.overrides || {} : {};
  const overrides = { ...current, [normalized]: iconUrl };

  await setDoc(
    doc(db, ...SETTINGS_DOC),
    {
      overrides,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return overrides;
}

export async function removeAssetTypeIconOverride(typeKey) {
  const normalized = normalizeAssetTypeKey(typeKey);
  const snap = await getDoc(doc(db, ...SETTINGS_DOC));
  if (!snap.exists()) return {};

  const current = { ...(snap.data()?.overrides || {}) };
  delete current[normalized];

  await setDoc(
    doc(db, ...SETTINGS_DOC),
    {
      overrides: current,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return current;
}

/** Upload a custom marker image for an asset type. */
export async function uploadAssetTypeIcon(typeKey, imageFile) {
  const normalized = normalizeAssetTypeKey(typeKey);
  if (!normalized) throw new Error("Asset type is required");
  if (!imageFile) throw new Error("Image file is required");

  const ext = (imageFile.name.split(".").pop() || "png").toLowerCase();
  const safeName = normalized.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const fileName = `${safeName}_${Date.now()}.${ext}`;
  const storageRef = ref(storage, `uploads/asset-icons/${fileName}`);

  await uploadBytes(storageRef, imageFile);
  return getDownloadURL(storageRef);
}
