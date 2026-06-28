"use client";

import { useMemo } from "react";
import {
  Building,
  Building2,
  GalleryVerticalEnd,
  Home,
  HousePlug,
  MapPlus,
  Network,
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

const teams = [
  {
    name: "Vision365",
    logo: GalleryVerticalEnd,
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
    title: "Dashboard",
    url: "/dashboard/",
    icon: Home,
    items: [{ title: "Community Overview", url: "/dashboard/community-overview" }],
  },
  {
    title: "Assets",
    url: "/dashboard/",
    icon: HousePlug,
    items: [
      { title: "Upload Assets", url: "/dashboard/assets" },
      { title: "Create Assets", url: "/dashboard/assets/create" },
      { title: "Map Assets", url: "/dashboard/assets/map_assets" },
      { title: "View/Edit Assets", url: "/dashboard/assets/view" },
    ],
  },
  {
    title: "Floor Mapping",
    url: "/dashboard/",
    icon: MapPlus,
    items: [
      { title: "Building Setup", url: "/dashboard/floor_configuration" },
      { title: "View Navigation", url: "/dashboard/floor_configuration/view" },
      { title: "Edit Floor Maps", url: "/dashboard/floor_configuration/edit" },
    ],
  },
  {
    title: "Network",
    url: "/dashboard/network",
    icon: Network,
    items: [{ title: "Telnet Client", url: "/dashboard/network" }],
  },
];

export function AppSidebar(props) {
  const router = useRouter();
  const { userEmail, logout } = useApp();

  const user = useMemo(
    () => ({
      name: "Admin",
      email: userEmail || "admin@vision365.com",
      avatar: "",
    }),
    [userEmail],
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
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogout={handleLogout} logoutIcon={LogOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
