/** Minimal route config — admin vs client */

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
  "/dashboard/alarm-messages/history",
  "/dashboard/live-fire",
  "/dashboard/live-trouble",
  "/dashboard/live-supervisory",
];

export const faqRoute = "/dashboard/faq";

/** Default landing page for client users */
export const clientMainRoute = "/dashboard/floor_configuration/view";

/** Client users — graphics view and alarm history */
export const clientRoutes = [
  clientMainRoute,
  "/dashboard/alarm-messages/history",
  "/dashboard/live-fire",
  "/dashboard/live-trouble",
  "/dashboard/live-supervisory",
];

export const roleRoutes = {
  admin: commonRoutes,
  client: clientRoutes,
};
