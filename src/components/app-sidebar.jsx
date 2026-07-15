"use client";

import { useMemo } from "react";
import {
  Bell,
  Building,
  Building2,
  MapPlus,
  Network,
  HousePlug,
  LogOut,
} from "lucide-react";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { getAllowedRoutesForRole, isPathAllowed } from "@/lib/roleAccess";

const teams = [
  {
    name: "Vision365",
    logoUrl: "/logo.png",
    plan: "Minimal",
  },
];

/** Sidebar — community, buildings, dashboard, floor maps, assets */
const navMain = [
  {
    title: "Community",
    url: "/dashboard/",
    icon: Building2,
    items: [
      { title: "Add Community", url: "/dashboard/community" },
      { title: "Assign Community", url: "/dashboard/community/assign" },
    ],
  },
  {
    title: "Buildings",
    url: "/dashboard/",
    icon: Building,
    items: [
      { title: "Add Buildings", url: "/dashboard/buildings" },
      { title: "Assign Buildings", url: "/dashboard/buildings/assign_buildings" },
      { title: "Edit Building", url: "/dashboard/buildings/edit_status" },
    ],
  },
  {
    title: "Assets",
    url: "/dashboard/",
    icon: HousePlug,
    items: [
      { title: "Upload Assets", url: "/dashboard/assets" },
      { title: "Create Assets", url: "/dashboard/assets/create" },
      { title: "View/Edit Assets", url: "/dashboard/assets/view" },
    ],
  },
  {
    title: "Graphics",
    url: "/dashboard/",
    icon: MapPlus,
    items: [
      { title: "Building Setup", url: "/dashboard/floor_configuration" },
      { title: "Graphics View", url: "/dashboard/floor_configuration/view" },
      { title: "Edit Floors", url: "/dashboard/floor_configuration/edit" },
    ],
  },
  {
    title: "Network",
    url: "/dashboard/network",
    icon: Network,
    items: [{ title: "Telnet Client", url: "/dashboard/network" }],
  },
  {
    title: "Alarm Messages",
    url: "/dashboard/alarm-messages/history",
    icon: Bell,
    items: [
      { title: "History", url: "/dashboard/alarm-messages/history" },
      { title: "Live Fire", url: "/dashboard/live-fire" },
      { title: "Live Trouble", url: "/dashboard/live-trouble" },
      { title: "Live Supervisory", url: "/dashboard/live-supervisory" },
    ],
  },
];

function buildNavItemsForRole(role) {
  const allowedRoutes = getAllowedRoutesForRole(role);
  const isAdmin = String(role || "").toLowerCase() === "admin";

  if (isAdmin) {
    return navMain;
  }

  return navMain
    .map((section) => ({
      ...section,
      items: (section.items || []).map((subItem) => ({
        ...subItem,
        disabled: !isPathAllowed(subItem.url, allowedRoutes),
      })),
    }))
    .filter((section) => section.items?.some((subItem) => !subItem.disabled));
}

export function AppSidebar(props) {
  const router = useRouter();
  const { userEmail, userRole, logout } = useApp();

  const user = useMemo(
    () => ({
      name: String(userRole || "").toLowerCase() === "client" ? "Client" : "Admin",
      email: userEmail || "client@vision365.com",
      avatar: "",
    }),
    [userEmail, userRole],
  );

  const navItems = useMemo(
    () => buildNavItemsForRole(userRole || "admin"),
    [userRole],
  );

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogout={handleLogout} logoutIcon={LogOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
