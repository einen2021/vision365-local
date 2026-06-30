"use client";

import { LoginForm } from "@/components/login-form";
import { ModeToggle } from "@/components/theme-toggle";
import { Vision365Logo } from "@/components/vision365-logo";

export function LoginPageShell() {
  return (
    <div className="min-h-svh">
      <div className="grid min-h-svh lg:grid-cols-2">
        <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-10">
          <div className="flex justify-center gap-2 md:justify-start">
            <a href="#" className="flex items-center gap-2 font-medium">
              <Vision365Logo className="h-8 w-8" />
              Vision365
            </a>
            <ModeToggle />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-xs">
              <LoginForm />
            </div>
          </div>
        </div>
        <div className="relative m-4 hidden overflow-hidden rounded-xl bg-muted lg:block">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
            <Vision365Logo className="h-24 w-24" />
            <p className="text-lg font-medium text-muted-foreground">Building Management</p>
          </div>
        </div>
      </div>
    </div>
  );
}
