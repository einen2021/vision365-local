"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { db } from "@/config/firebase";
import { collection, query, where, getDocs } from "@/lib/mockFirestore";
import { getDefaultHomeRoute } from "@/lib/roleAccess";
import { useApp } from "@/contexts/AppContext";
import { waitForDesktopApi } from "@/lib/apiClient";

/** Admin-only login form — credentials stored in data/db.json */
export function LoginForm({ className, ...props }) {
  const { toast } = useToast();
  const router = useRouter();
  const { login } = useApp();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.target);
    const email = formData.get("email");
    const password = formData.get("password");

    try {
      const userRef = collection(db, "UserDB");
      const q = query(userRef, where("email", "==", email));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        toast({
          title: "Login Failed",
          description: "Invalid email or password.",
          variant: "destructive",
        });
        return;
      }

      const userDoc = snapshot.docs[0];
      const userData = userDoc.data();

      if (password !== userData.password) {
        toast({
          title: "Login Failed",
          description: "Invalid email or password.",
          variant: "destructive",
        });
        return;
      }

      const role = String(userData.role || "").trim().toLowerCase();
      if (role !== "admin") {
        toast({
          title: "Access Denied",
          description: "Only admin users can log in to this app.",
          variant: "destructive",
        });
        return;
      }

      const sessionUser = {
        email: String(email || "").trim(),
        role: "admin",
        designation: userData.designation || "",
        isLoggedIn: true,
      };

      await login(sessionUser.email, "admin", sessionUser);

      toast({
        title: "Login Successful",
        description: "Redirecting to dashboard...",
      });

      router.push(getDefaultHomeRoute());
    } catch (error) {
      console.error("Login error:", error);
      const message =
        error?.message?.includes("database server") ||
        error?.message?.includes("API request failed") ||
        error?.message?.includes("fetch")
          ? "Could not connect to the local database. Please restart the app."
          : "Something went wrong. Please try again.";
      toast({
        title: "Login Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={cn("flex flex-col gap-6", className)} {...props} onSubmit={handleSubmit}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Admin Login</h1>
        <p className="text-balance text-sm text-muted-foreground">
          Vision365 Minimal — JSON data store
        </p>
      </div>
      <div className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="admin@vision365.com"
            defaultValue="admin@vision365.com"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" defaultValue="admin123" required />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </Button>
      </div>
    </form>
  );
}
