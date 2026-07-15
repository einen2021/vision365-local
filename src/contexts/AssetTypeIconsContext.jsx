"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/config/firebase";
import { setAssetTypeIconOverrides, normalizeAssetTypeKey } from "@/lib/assetIcons";
import {
  loadAssetTypeIconOverrides,
  removeAssetTypeIconOverride,
  saveAssetTypeIconOverride,
  uploadAssetTypeIcon,
} from "@/lib/assetTypeIconStorage";
import { preloadAssetImage, preloadAssetImages } from "@/lib/assetUrlCache";

const AssetTypeIconsContext = createContext(null);

export function AssetTypeIconsProvider({ children }) {
  const [overrides, setOverrides] = useState({});
  const [knownTypes, setKnownTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [savedOverrides, typeSet] = await Promise.all([
        loadAssetTypeIconOverrides(),
        loadKnownAssetTypes(),
      ]);
      await preloadAssetImages(Object.values(savedOverrides));
      setOverrides(savedOverrides);
      setKnownTypes(typeSet);
      setAssetTypeIconOverrides(savedOverrides);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadTypeIcon = useCallback(async (typeKey, file) => {
    const iconUrl = await uploadAssetTypeIcon(typeKey, file);
    await preloadAssetImage(iconUrl);
    const next = await saveAssetTypeIconOverride(typeKey, iconUrl);
    setOverrides(next);
    setAssetTypeIconOverrides(next);
    return iconUrl;
  }, []);

  const clearTypeIcon = useCallback(async (typeKey) => {
    const next = await removeAssetTypeIconOverride(typeKey);
    setOverrides(next);
    setAssetTypeIconOverrides(next);
  }, []);

  const value = useMemo(
    () => ({
      overrides,
      knownTypes,
      loading,
      refresh,
      uploadTypeIcon,
      clearTypeIcon,
    }),
    [overrides, knownTypes, loading, refresh, uploadTypeIcon, clearTypeIcon],
  );

  return (
    <AssetTypeIconsContext.Provider value={value}>{children}</AssetTypeIconsContext.Provider>
  );
}

export function useAssetTypeIcons() {
  const ctx = useContext(AssetTypeIconsContext);
  if (!ctx) {
    throw new Error("useAssetTypeIcons must be used within AssetTypeIconsProvider");
  }
  return ctx;
}

async function loadKnownAssetTypes() {
  const snap = await getDocs(collection(db, "AssetsList"));
  const types = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const key = normalizeAssetTypeKey(data.itemType || data.assetName || data.description);
    if (key) types.add(key);
  });

  return Array.from(types).sort((a, b) => a.localeCompare(b));
}
