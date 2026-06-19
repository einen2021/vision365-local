"use client";

/**
 * usePageAuth — simple login check for dashboard pages.
 *
 * Instead of reading secureLocalStorage yourself, use this hook.
 *
 * Example (basic):
 *   const { user, userEmail, role, isReady } = usePageAuth();
 *
 * Example (redirect if not logged in):
 *   const { user, isReady } = usePageAuth({ redirectIfLoggedOut: true });
 *
 * Example (admin only):
 *   usePageAuth({ redirectIfLoggedOut: true, allowedRoles: ["admin"] });
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/hooks/useAppData";

export function usePageAuth(options = {}) {
  const {
    redirectIfLoggedOut = false,
    allowedRoles = null,
    redirectUnauthorizedTo = "/unauthorized",
  } = options;

  const router = useRouter();
  const app = useAppData();
  const role = app.effectiveRole || app.userRole || "";

  // Redirect to login or unauthorized page if needed
  useEffect(() => {
    if (!redirectIfLoggedOut) return;
    if (!app.isInitialized) return;

    if (!app.isAuthenticated || !app.userEmail) {
      router.push("/");
      return;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const current = String(role).toLowerCase();
      const allowed = allowedRoles.map((r) => String(r).toLowerCase());
      if (!allowed.includes(current)) {
        router.push(redirectUnauthorizedTo);
      }
    }
  }, [
    redirectIfLoggedOut,
    allowedRoles,
    app.isAuthenticated,
    app.isInitialized,
    app.userEmail,
    role,
    router,
    redirectUnauthorizedTo,
  ]);

  return {
    user: app.user,
    userEmail: app.userEmail,
    userRole: app.userRole,
    role,
    effectiveRole: app.effectiveRole,
    isAuthenticated: app.isAuthenticated,
    isReady: app.isReady,
    isLoading: app.isLoading,
    isInitialized: app.isInitialized,
    communities: app.communities,
    buildingNames: app.buildingNames,
    staffList: app.staffList,
    refetch: app.refetch,
    refetchCommunities: app.refetchCommunities,
  };
}
