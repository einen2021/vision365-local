"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { setTheme, theme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => {
        const nextTheme = theme === "dark" ? "light" : "dark";
        setTheme(nextTheme);
      }}
    >
      <Moon
        className={`absolute h-[1.2rem] w-[1.2rem] transition-all ${
          theme === "dark" ? "rotate-0 scale-100" : "rotate-90 scale-0"
        }`}
      />
      <Sun
        className={`h-[1.2rem] w-[1.2rem] transition-all ${
          theme === "dark" ? "rotate-0 scale-0" : "rotate-0 scale-100"
        }`}
      />
      
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
