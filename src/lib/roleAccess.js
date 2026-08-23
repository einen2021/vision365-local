import { roleRoutes, commonRoutes, clientMainRoute } from "@/config/role-routes";

export function normalizeRoleKey(role) {
  return String(role || "").trim().toLowerCase();
}

export function extractLoginRole(userData) {
  const role = normalizeRoleKey(userData?.role);
  if (role) return role;
  const designation = normalizeRoleKey(userData?.designation);
  if (designation) return designation;
  return "";
}

export function isUserLoggedIn(user) {
  return Boolean(user?.email && user?.isLoggedIn !== false);
}

export function getDefaultHomeRoute(role) {
  const key = normalizeRoleKey(role);
  if (key === "client") return clientMainRoute;
  return clientMainRoute;
}

export function getAllowedRoutesForRole(role) {
  return buildAllowedRoutes(role).routes;
}

export function normalizePathname(path) {
  if (!path) return "/";
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

export function buildAllowedRoutes(loginKey) {
  const key = normalizeRoleKey(loginKey);
  const routes = roleRoutes[key] || commonRoutes;
  return { isAdmin: key === "admin", routes };
}

export function isPathAllowed(pathname, allowedRoutes) {
  const path = normalizePathname(pathname);
  return allowedRoutes.some((route) => {
    const r = normalizePathname(route);
    if (path === r) return true;
    if (path.startsWith(`${r}/`)) {
      // If path matches a distinct known common route not included in allowedRoutes, disallow it
      const matchesOtherCommonRoute = commonRoutes.some((cr) => {
        const ncr = normalizePathname(cr);
        return ncr !== r && (path === ncr || path.startsWith(`${ncr}/`));
      });
      if (matchesOtherCommonRoute) {
        return allowedRoutes.some((ar) => {
          const nar = normalizePathname(ar);
          return path === nar || path.startsWith(`${nar}/`);
        });
      }
      return true;
    }
    return false;
  });
}

export function isConsultantLikeRole() {
  return false;
}

export function isConsultantRole() {
  return false;
}

export function isConsultantPathAllowed() {
  return false;
}
