/** Minimal FAQ registry stub — help banners hidden when no guide exists */

export function normalizePath(path) {
  if (!path) return "/";
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

export function getPageGuideRoot() {
  return null;
}

export function getFaqArticleById() {
  return null;
}
