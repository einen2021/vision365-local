"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import secureLocalStorage from "react-secure-storage";
import { publicRoutes } from "@/config/role-routes";
import {
  getDefaultHomeRoute,
  getAllowedRoutesForRole,
  isPathAllowed,
  isUserLoggedIn,
} from "@/lib/roleAccess";
import { parseStoredUser } from "@/lib/sessionUser";
import { LoginPageShell } from "@/components/login-page-shell";
import { useApp } from "@/contexts/AppContext";

function isDashboardPath(pathname) {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

function AuthCheckingPlaceholder() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

/** Route guard — admin has full access; client is limited to allowed routes */
export function RoleGuard({ children }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const { isAuthenticated, userEmail } = useApp();
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState("loading");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    if (publicRoutes.includes(pathname)) {
      setView("app");
      return;
    }

    const user = parseStoredUser(secureLocalStorage.getItem("user"));
    const sessionActive = isAuthenticated && Boolean(userEmail) && isUserLoggedIn(user);

    if (!sessionActive) {
      if (isDashboardPath(pathname)) {
        setView("dashboard-login");
      } else {
        router.replace("/");
      }
      return;
    }

    const role = String(user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "client") {
      router.replace("/unauthorized");
      return;
    }

    if (isDashboardPath(pathname)) {
      const allowedRoutes = getAllowedRoutesForRole(role);
      if (!isPathAllowed(pathname, allowedRoutes)) {
        router.replace(getDefaultHomeRoute(role));
        return;
      }
    }

    setView("app");
  }, [mounted, pathname, router, isAuthenticated, userEmail]);

  if (!mounted) {
    return publicRoutes.includes(pathname) ? children : <AuthCheckingPlaceholder />;
  }

  if (publicRoutes.includes(pathname)) return children;
  if (view === "dashboard-login") return <LoginPageShell />;
  if (view === "loading") return <AuthCheckingPlaceholder />;
  return children;
}
