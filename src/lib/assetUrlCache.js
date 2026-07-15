/** Shared caches for floor-plan / marker image URLs (desktop + web). */

const resolvedUrlCache = new Map();
const loadedImageUrls = new Set();
const inflightPreloads = new Map();

export function getCachedResolvedUrl(source) {
  if (!source) return "";
  return resolvedUrlCache.get(source) || "";
}

export function cacheResolvedUrl(source, resolved) {
  if (!source || !resolved) return;
  resolvedUrlCache.set(source, resolved);
}

export function isAssetImageLoaded(url) {
  return Boolean(url && loadedImageUrls.has(url));
}

export function markAssetImageLoaded(url) {
  if (url) loadedImageUrls.add(url);
}

/** Preload an image URL once; reused across all markers of the same type. */
export function preloadAssetImage(url) {
  if (!url) return Promise.resolve(false);
  if (loadedImageUrls.has(url)) return Promise.resolve(true);

  const pending = inflightPreloads.get(url);
  if (pending) return pending;

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      loadedImageUrls.add(url);
      inflightPreloads.delete(url);
      resolve(true);
    };
    img.onerror = () => {
      inflightPreloads.delete(url);
      resolve(false);
    };
    img.src = url;
  });

  inflightPreloads.set(url, promise);
  return promise;
}

export function preloadAssetImages(urls = []) {
  const unique = [...new Set(urls.filter(Boolean))];
  return Promise.all(unique.map((url) => preloadAssetImage(url)));
}
