import { Hono } from "hono";
import { login, logout, validateSession, changePassword } from "../services/authService";

const auth = new Hono();

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json();
  const result = await login(email, password);
  if (!result.success) {
    return c.json({ success: false, message: result.message }, 401);
  }
  return c.json({
    success: true,
    user: result.user,
    token: result.token,
  });
});

auth.post("/logout", async (c) => {
  const { token } = await c.req.json();
  if (token) await logout(token);
  return c.json({ ok: true });
});

auth.get("/session", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ authenticated: false }, 401);
  const user = await validateSession(token);
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, user });
});

auth.post("/change-password", async (c) => {
  const { userId, currentPassword, newPassword } = await c.req.json();
  const result = await changePassword(userId, currentPassword, newPassword);
  if (!result.success) return c.json(result, 400);
  return c.json(result);
});

export default auth;
