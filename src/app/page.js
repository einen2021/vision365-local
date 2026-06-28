"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { useApp } from "@/contexts/AppContext";
import { getDefaultHomeRoute } from "@/lib/roleAccess";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, userRole } = useApp();

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(getDefaultHomeRoute(userRole));
    }
  }, [isAuthenticated, userRole, router]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
