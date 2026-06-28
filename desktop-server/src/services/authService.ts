import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getCollection } from "../db/client";
import { readDb } from "../db/documentStore";

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
  const users = getCollection("users");
  const normalizedEmail = email.trim().toLowerCase();

  let user = await users.findOne({ email: { $regex: new RegExp(`^${normalizedEmail}$`, "i") } });

  // Fallback: check UserDB in document store (plaintext, legacy)
  if (!user) {
    const db = await readDb();
    const userDb = (db.UserDB || {}) as Record<
      string,
      { email?: string; password?: string; role?: string; designation?: string }
    >;

    const entry = Object.entries(userDb).find(
      ([, u]) => u.email?.toLowerCase() === normalizedEmail
    );

    if (entry) {
      const [id, userData] = entry;
      if (password !== userData.password) {
        return { success: false, message: "Invalid email or password" };
      }

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      const doc = {
        _id: id,
        id,
        email: userData.email!,
        password_hash: hash,
        role: userData.role || "admin",
        designation: userData.designation || "",
        created_at: now,
        updated_at: now,
      };
      await users.replaceOne({ _id: id }, doc, { upsert: true });
      user = doc;
    }
  }

  if (!user) {
    return { success: false, message: "Invalid email or password" };
  }

  const valid = await bcrypt.compare(password, user.password_hash as string);
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

  const sessions = getCollection("sessions");
  await sessions.insertOne({
    _id: sessionId,
    id: sessionId,
    user_id: user.id as string,
    token,
    expires_at: expiresAt,
    created_at: now,
  });

  return {
    success: true,
    user: {
      id: user.id as string,
      email: user.email as string,
      role: user.role as string,
      designation: (user.designation as string) || "",
    },
    token,
  };
}

export async function validateSession(token: string): Promise<AuthUser | null> {
  const sessions = getCollection("sessions");
  const users = getCollection("users");
  const now = new Date().toISOString();

  const session = await sessions.findOne({ token, expires_at: { $gt: now } });
  if (!session) return null;

  const user = await users.findOne({ id: session.user_id });
  if (!user) return null;

  return {
    id: user.id as string,
    email: user.email as string,
    role: user.role as string,
    designation: (user.designation as string) || "",
  };
}

export async function logout(token: string): Promise<void> {
  const sessions = getCollection("sessions");
  await sessions.deleteOne({ token });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; message?: string }> {
  const users = getCollection("users");
  const user = await users.findOne({ id: userId });

  if (!user) return { success: false, message: "User not found" };

  const valid = await bcrypt.compare(currentPassword, user.password_hash as string);
  if (!valid) return { success: false, message: "Current password is incorrect" };

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await users.updateOne(
    { id: userId },
    { $set: { password_hash: hash, updated_at: new Date().toISOString() } }
  );

  return { success: true };
}
