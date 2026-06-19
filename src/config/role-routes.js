/** Minimal route config — admin only */

export const publicRoutes = ["/", "/unauthorized"];

export const communityOverviewRoute = "/dashboard/community-overview";
export const financeDashboardRoute = "/dashboard/finance";
export const commonRoutes = [
  "/dashboard/community",
  "/dashboard/community/assign",
  "/dashboard/buildings",
  "/dashboard/buildings/assign_buildings",
  "/dashboard/buildings/edit_status",
  "/dashboard/community-overview",
  "/dashboard/floor_configuration",
  "/dashboard/floor_configuration/view",
  "/dashboard/floor_configuration/edit",
  "/dashboard/assets",
  "/dashboard/assets/create",
  "/dashboard/assets/map_assets",
  "/dashboard/assets/view",
  "/dashboard/assets/view/details",
  "/dashboard/network",
];

export const faqRoute = "/dashboard/faq";

export const roleRoutes = {
  admin: commonRoutes,
};
