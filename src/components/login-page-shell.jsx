"use client";

import { GalleryVerticalEnd } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { ModeToggle } from "@/components/theme-toggle";

export function LoginPageShell() {
  return (
    <div className="min-h-svh">
      <div className="grid min-h-svh lg:grid-cols-2">
        <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-10">
          <div className="flex justify-center gap-2 md:justify-start">
            <a href="#" className="flex items-center gap-2 font-medium">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <GalleryVerticalEnd className="size-4" />
              </div>
              Vision365 Minimal
            </a>
            <ModeToggle />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-xs">
              <LoginForm />
            </div>
          </div>
        </div>
        <div className="relative m-4 hidden rounded-xl bg-muted lg:block">
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
            <p className="text-lg font-medium text-muted-foreground">Building Management</p>
          </div>
        </div>
      </div>
    </div>
  );
}
