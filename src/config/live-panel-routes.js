/** Routes and labels for live fire-panel list pages. */

export const LIVE_FIRE_ROUTE = "/dashboard/live-fire";
export const LIVE_TROUBLE_ROUTE = "/dashboard/live-trouble";
export const LIVE_SUPERVISORY_ROUTE = "/dashboard/live-supervisory";

export const LIVE_PANEL_PAGES = [
  {
    label: "Fire",
    title: "Live Fire",
    ackTitle: "Fire Ack",
    route: LIVE_FIRE_ROUTE,
    tone: "fire",
  },
  {
    label: "Trouble",
    title: "Live Trouble",
    ackTitle: "Trouble Ack",
    route: LIVE_TROUBLE_ROUTE,
    tone: "trouble",
  },
  {
    label: "Supervisory",
    title: "Live Supervisory",
    ackTitle: "Sup Ack",
    route: LIVE_SUPERVISORY_ROUTE,
    tone: "supervisory",
  },
];

export const LIVE_PANEL_ROUTE_BY_LABEL = Object.fromEntries(
  LIVE_PANEL_PAGES.map((page) => [page.label, page.route]),
);

export const LIVE_PANEL_PAGE_BY_ROUTE = Object.fromEntries(
  LIVE_PANEL_PAGES.map((page) => [page.route, page]),
);
