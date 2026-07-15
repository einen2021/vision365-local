"use client";

/**
 * useAppData — the main hook dashboard pages should use.
 *
 * Gives you communities, buildings, user info, and loading flags.
 * Data is loaded once in AppContext and shared everywhere.
 *
 * Example:
 *   const { communities, userEmail, role, isReady } = useAppData();
 */

import { useApp } from "@/contexts/AppContext";

export function useAppData(_options = {}) {
  const ctx = useApp();
  const effectiveRole = ctx.effectiveFetchRole || ctx.userRole;
  const buildingNames = ctx.getAssignedBuildings();
  const scopedCommunities = ctx.getScopedCommunities();

  const {
    firePanelMonitoring: _fm,
    firePanelMonitorLogs: _fml,
    firePanelState: _fps,
    firePanelStateLoading: _fpsl,
    startFirePanelMonitoring: _sfm,
    stopFirePanelMonitoring: _stopfm,
    toggleFirePanelMonitoring: _tfm,
    fetchFirePanelState: _ffps,
    ...appData
  } = ctx;

  return {
    ...appData,
    effectiveRole,
    role: effectiveRole,
    buildingNames,
    communities: scopedCommunities,
    scopedCommunities,
    isLoadingCommunities: ctx.loadingStates?.communities ?? false,
    isReady: ctx.isInitialized && !ctx.isLoading,
    refetch: ctx.refreshGlobalData,
  };
}
