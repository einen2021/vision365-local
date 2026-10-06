"use client";

import { useState } from "react";
import { RotateCcw, Power, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { triggerEmergencyExit, triggerRestartApp } from "@/lib/appControl";
import { cn } from "@/lib/utils";

/**
 * Restart Application confirmation dialog.
 */
export function RestartAppDialog({ open, onOpenChange }) {
  const handleRestart = () => {
    onOpenChange(false);
    triggerRestartApp();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
              <RotateCcw className="h-5 w-5" />
            </div>
            <AlertDialogTitle>Restart Application</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2 text-sm leading-relaxed">
            Are you sure you want to restart Vision365? This will refresh all
            data, re-verify fire panel connections, and reload the application.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRestart}
            className="bg-primary hover:bg-primary/90"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Restart App
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Emergency Exit confirmation dialog.
 */
export function EmergencyExitDialog({ open, onOpenChange }) {
  const handleExit = () => {
    onOpenChange(false);
    triggerEmergencyExit();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md border-destructive/20">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-destructive">
              Emergency Exit
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
            Are you sure you want to immediately terminate Vision365? This will
            stop all background services and close the application immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleExit}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Power className="mr-2 h-4 w-4" />
            Exit Vision365
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Top bar / toolbar button to trigger restart with confirm dialog.
 */
export function RestartButton({ className, showLabel = true, size = "sm" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        className={cn(
          "gap-1.5 border-border/80 text-xs font-medium hover:bg-muted/80",
          className,
        )}
        title="Restart Application (Reload & Reconnect)"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {showLabel && <span>Restart</span>}
      </Button>

      <RestartAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Emergency exit icon button.
 */
export function EmergencyExitIconButton({ className, size = "icon" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
          className,
        )}
        title="Emergency Exit Vision365"
        aria-label="Emergency Exit"
      >
        <Power className="h-4 w-4" />
      </Button>

      <EmergencyExitDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Close Window confirmation dialog (when window close button or Alt+F4 is clicked).
 */
export function CloseWindowDialog({ open, onOpenChange }) {
  const handleClose = () => {
    onOpenChange(false);
    triggerEmergencyExit();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <AlertDialogTitle>Exit Vision365?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
            Are you sure you want to close Vision365? All live monitoring and fire panel services will be stopped.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleClose}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Power className="mr-2 h-4 w-4" />
            Close Application
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

