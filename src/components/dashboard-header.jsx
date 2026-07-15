"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";
import { AssetDeviceSearchBar } from "@/components/asset-device-search-bar";
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  { ssr: false, loading: () => <div className="h-9 w-9" /> },
);

/** Sticky dashboard header row + device search strip. */
export function DashboardTopBar({ headerClassName }) {
  return (
    <div className="sticky top-0 z-30 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <header
        className={
          headerClassName ||
          "flex h-16 shrink-0 items-center gap-2 px-4 md:px-8"
        }
      >
        <SidebarTrigger className="-ml-1" />
        <ClientModeToggle />
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <FirePanelStatusBadges />
        </div>
      </header>
      <AssetDeviceSearchBar />
    </div>
  );
}

/** Scrollable page body below the sticky header + search bar. */
export function DashboardPageContent({ children, className }) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Full dashboard shell: sidebar, sticky header, search bar, and page content. */
export function DashboardHeader({ children, headerClassName, contentClassName }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardTopBar headerClassName={headerClassName} />
        <DashboardPageContent className={contentClassName}>
          {children}
        </DashboardPageContent>
      </SidebarInset>
    </SidebarProvider>
  );
}
