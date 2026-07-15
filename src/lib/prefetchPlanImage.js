import { isDesktop } from "@/lib/platform";
import {
  normalizeLocalAssetUrl,
  primeAssetUrlResolver,
  resolveAssetUrl,
  resolveDesktopAssetUrl,
} from "@/lib/apiClient";
import {
  cacheResolvedUrl,
  getCachedResolvedUrl,
  preloadAssetImage,
} from "@/lib/assetUrlCache";

/** Resolve a stored floor-plan image URL and cache it for PlanImageCanvas. */
export async function resolvePlanImageUrl(url) {
  const source = normalizeLocalAssetUrl(url || "");
  if (!source) return "";

  const cached = getCachedResolvedUrl(source);
  if (cached) return cached;

  if (isDesktop() && source.startsWith("/local/")) {
    const resolved = await resolveDesktopAssetUrl(source);
    cacheResolvedUrl(source, resolved);
    return resolved;
  }

  await primeAssetUrlResolver();

  if (source.startsWith("/local/")) {
    const resolved = await resolveDesktopAssetUrl(source);
    cacheResolvedUrl(source, resolved);
    return resolved;
  }

  const resolved = resolveAssetUrl(source);
  cacheResolvedUrl(source, resolved);
  return resolved;
}

/** Warm the image cache so subsection/section plans open faster. */
export async function prefetchPlanImageUrl(url) {
  const resolved = await resolvePlanImageUrl(url);
  if (resolved) await preloadAssetImage(resolved);
  return resolved;
}

export function prefetchPlanImageUrls(urls = []) {
  const unique = [...new Set(urls.filter(Boolean))];
  return Promise.all(unique.map((url) => prefetchPlanImageUrl(url)));
}
