"use client";

/**
 * Simplified AppContext for admin-only JSON-backed app.
 * All data is loaded from data/db.json via mock Firestore.
 */

import React, { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import secureLocalStorage from "react-secure-storage";
import { db } from "@/config/firebase";
import { collection, getDocs } from "@/lib/mockFirestore";
import { getUserCommunities } from "@/utils/communityService";
import { loadBrandRegistry } from "@/utils/brandRegistryService";
import { getStoredSessionUser } from "@/lib/sessionUser";
import { normalizeBuildingName } from "@/lib/buildingNames";

const AppContext = createContext(undefined);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
};

export const AppProvider = ({ children }) => {
  const pathname = usePathname();

  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [effectiveFetchRole, setEffectiveFetchRole] = useState("admin");
  const [userEmail, setUserEmail] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [communities, setCommunities] = useState([]);
  const [globalAssets, setGlobalAssets] = useState([]);
  const [brandRegistry, setBrandRegistry] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [allBuildings, setAllBuildings] = useState([]);

  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [buildingCache, setBuildingCache] = useState({});

  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    communities: false,
    assets: false,
    brands: false,
    staff: false,
    jobs: false,
  });

  // Sync session from local storage
  useEffect(() => {
    const session = getStoredSessionUser();
    const email = String(session?.email || localStorage.getItem("userEmail") || "").trim();

    if (!email) {
      setIsAuthenticated(false);
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    const role = session?.role || localStorage.getItem("userRole") || "admin";
    setUserEmail(email);
    setUserRole(role);
    setEffectiveFetchRole("admin");
    setUser(session || { email, role });
    setIsAuthenticated(true);
  }, [pathname]);

  // Load data when authenticated
  useEffect(() => {
    if (!isAuthenticated || !userEmail || isInitialized) return;

    async function loadAll() {
      setIsLoading(true);
      try {
        await Promise.all([loadCommunities(), loadAssets(), loadBrands(), loadStaff(), loadJobs()]);
      } catch (err) {
        setError({ global: err.message });
      } finally {
        setIsLoading(false);
        setIsInitialized(true);
      }
    }

    loadAll();
  }, [isAuthenticated, userEmail, isInitialized]);

  useEffect(() => {
    const names = new Set();
    communities.forEach((c) => {
      (c.buildings || []).forEach((b) => {
        const n = normalizeBuildingName(b);
        if (n) names.add(n);
      });
    });
    setAllBuildings([...names].map((name) => ({ name })));
  }, [communities]);

  async function loadCommunities() {
    setLoadingStates((s) => ({ ...s, communities: true }));
    try {
      const res = await getUserCommunities(userEmail, "admin");
      setCommunities(res.communities || []);
    } catch (err) {
      setError((e) => ({ ...e, communities: err.message }));
    } finally {
      setLoadingStates((s) => ({ ...s, communities: false }));
    }
  }

  async function loadAssets() {
    setLoadingStates((s) => ({ ...s, assets: true }));
    try {
      const snap = await getDocs(collection(db, "AssetsList"));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, name: d.data().description || d.id, ...d.data() }));
      setGlobalAssets(list);
    } finally {
      setLoadingStates((s) => ({ ...s, assets: false }));
    }
  }

  async function loadBrands() {
    setLoadingStates((s) => ({ ...s, brands: true }));
    try {
      setBrandRegistry(await loadBrandRegistry(db, getDocs, collection));
    } finally {
      setLoadingStates((s) => ({ ...s, brands: false }));
    }
  }

  async function loadStaff() {
    setLoadingStates((s) => ({ ...s, staff: true }));
    try {
      const snap = await getDocs(collection(db, "Staffs"));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setStaffList(list);
    } finally {
      setLoadingStates((s) => ({ ...s, staff: false }));
    }
  }

  async function loadJobs() {
    setLoadingStates((s) => ({ ...s, jobs: true }));
    try {
      const snap = await getDocs(collection(db, "jobs"));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setJobs(list);
    } finally {
      setLoadingStates((s) => ({ ...s, jobs: false }));
    }
  }

  async function login(email, role, sessionUser) {
    secureLocalStorage.setItem("user", sessionUser);
    localStorage.setItem("userEmail", email);
    localStorage.setItem("userRole", role);
    setUserEmail(email);
    setUserRole(role);
    setEffectiveFetchRole("admin");
    setUser(sessionUser);
    setIsAuthenticated(true);
    setIsInitialized(false);
    setIsLoading(true);
  }

  function logout() {
    secureLocalStorage.removeItem("user");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userRole");
    setUser(null);
    setUserEmail(null);
    setUserRole(null);
    setIsAuthenticated(false);
    setCommunities([]);
    setGlobalAssets([]);
    setIsInitialized(false);
  }

  function getScopedCommunities() {
    return communities;
  }

  function getAssignedBuildings() {
    return allBuildings.map((b) => b.name);
  }

  async function refreshGlobalData() {
    setIsInitialized(false);
    setIsLoading(true);
  }

  async function refetchCommunities() {
    await loadCommunities();
  }

  const value = {
    user,
    userRole,
    userEmail,
    effectiveFetchRole,
    isAuthenticated,
    communities,
    globalAssets,
    brandRegistry,
    staffList,
    jobs,
    allBuildings,
    selectedCommunity,
    selectedBuilding,
    buildingCache,
    setSelectedCommunity,
    setSelectedBuilding,
    setBuildingCache,
    isLoading,
    isInitialized,
    error,
    loadingStates,
    login,
    logout,
    getScopedCommunities,
    getAssignedBuildings,
    refreshGlobalData,
    refetch: refreshGlobalData,
    refetchCommunities,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
