/**
 * Local API endpoints — web: Next.js routes, desktop: local Hono server.
 */

import { getApiBaseUrl } from "@/lib/apiClient";

const endpoints = {
  get allbuildings() {
    return `${getApiBaseUrl()}/api/building/all`;
  },
  get getusers() {
    return `${getApiBaseUrl()}/api/admin/get-mails`;
  },
  get getUnassignedBuildings() {
    return `${getApiBaseUrl()}/api/buildings/unassigned`;
  },
  get getBuildingsWithCommunityStatus() {
    return `${getApiBaseUrl()}/api/buildings/with-community-status`;
  },
  getCommunityBuildings: (communityId) =>
    `${getApiBaseUrl()}/api/community/${communityId}/buildings`,
  assignBuildingsToCommunity: (communityId) =>
    `${getApiBaseUrl()}/api/community/${communityId}/assign-buildings`,
  removeBuildingsFromCommunity: (communityId) =>
    `${getApiBaseUrl()}/api/community/${communityId}/remove-buildings`,
};

export default endpoints;
