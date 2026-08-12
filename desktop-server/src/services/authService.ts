import crypto from "crypto";
import bcrypt from "bcryptjs";
import { readDb } from "../db/documentStore";
import {
  findUserByEmail,
  findUserById,
  upsertUser,
  insertSession,
  findValidSession,
  deleteSessionByToken,
  updateUserPassword,
} from "../db/repos";

const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 12;

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  designation: string;
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  token?: string;
  message?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();

  let user = findUserByEmail(normalizedEmail);

  // Fallback: check UserDB in document store (plaintext, legacy)
  if (!user) {
    const db = readDb();
    const userDb = (db.UserDB || {}) as Record<
      string,
      { email?: string; password?: string; role?: string; designation?: string }
    >;

    const entry = Object.entries(userDb).find(
      ([, u]) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (entry) {
      const [id, userData] = entry;
      if (password !== userData.password) {
        return { success: false, message: "Invalid email or password" };
      }

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      upsertUser({
        id,
        email: userData.email!,
        password_hash: hash,
        role: userData.role || "admin",
        designation: userData.designation || "",
        created_at: now,
        updated_at: now,
      });
      user = findUserById(id);
    }
  }

  if (!user) {
    return { success: false, message: "Invalid email or password" };
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return { success: false, message: "Invalid email or password" };
  }

  const role = String(user.role || "").trim().toLowerCase();
  if (role !== "admin" && role !== "client") {
    return { success: false, message: "This account is not allowed to log in" };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const sessionId = `sess_${Date.now()}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  insertSession({
    id: sessionId,
    user_id: user.id,
    token,
    expires_at: expiresAt,
    created_at: now,
  });

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      designation: user.designation || "",
    },
    token,
  };
}

export async function validateSession(token: string): Promise<AuthUser | null> {
  const session = findValidSession(token);
  if (!session) return null;

  const user = findUserById(session.user_id);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    designation: user.designation || "",
  };
}

export async function logout(token: string): Promise<void> {
  deleteSessionByToken(token);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ success: boolean; message?: string }> {
  const user = findUserById(userId);

  if (!user) return { success: false, message: "User not found" };

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return { success: false, message: "Current password is incorrect" };

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  updateUserPassword(userId, hash);

  return { success: true };
}
