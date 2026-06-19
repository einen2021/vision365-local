"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Unauthorized</h1>
      <p className="text-muted-foreground">Only admin users can access this application.</p>
      <Button asChild>
        <Link href="/">Back to Login</Link>
      </Button>
    </div>
  );
}
