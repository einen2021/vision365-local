import secureLocalStorage from "react-secure-storage";
import { extractLoginRole, isUserLoggedIn } from "@/lib/roleAccess";

export function parseStoredUser(userData) {
  if (userData === null || userData === undefined) return null;
  if (typeof userData === "string") {
    const trimmed = userData.trim();
    if (!trimmed || trimmed === "[object Object]") return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof userData === "object") return userData;
  return null;
}

/** @returns {{ email: string, role: string, designation?: string, isLoggedIn?: boolean } | null} */
export function getStoredSessionUser() {
  const user = parseStoredUser(secureLocalStorage.getItem("user"));
  if (!isUserLoggedIn(user) || !user?.email) return null;
  const role =
    extractLoginRole(user) ||
    String(user.role || "")
      .trim()
      .toLowerCase();
  return {
    ...user,
    email: String(user.email).trim(),
    role,
  };
}
