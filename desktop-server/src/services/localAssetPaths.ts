import fs from "fs";
import { safePath, resolveLegacyAppDataPath } from "./storageService";

/** Decode /local/... URL path into a relative app-data path. */
export function relativePathFromLocalUrl(urlOrPath: string): string {
  const raw = urlOrPath
    .replace(/^\/local\//, "")
    .replace(/^\//, "")
    .replace(/\\/g, "/");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Candidate on-disk locations for a stored asset (supports legacy paths). */
export function localAssetCandidates(
  appRoot: string,
  relativePath: string,
): string[] {
  const normalized = relativePath.replace(/\\/g, "/");
  const candidates: string[] = [safePath(appRoot, normalized)];

  if (!normalized.startsWith("uploads/")) {
    candidates.push(safePath(appRoot, "uploads", normalized));
  }
  if (normalized.startsWith("uploads/floor-plans/")) {
    candidates.push(
      safePath(appRoot, normalized.replace(/^uploads\//, "")),
    );
  }
  if (normalized.startsWith("floor-plans/")) {
    candidates.push(safePath(appRoot, "uploads", normalized));
  }

  // Also check legacy %APPDATA%/Vision365 if files were saved there before.
  const legacyRoot = resolveLegacyAppDataPath();
  if (legacyRoot && legacyRoot !== appRoot) {
    candidates.push(safePath(legacyRoot, normalized));
    if (normalized.startsWith("floor-plans/")) {
      candidates.push(safePath(legacyRoot, "uploads", normalized));
    }
  }

  return candidates;
}

export function findLocalAssetFile(
  appRoot: string,
  urlOrRelativePath: string,
): string | null {
  const relative = relativePathFromLocalUrl(urlOrRelativePath);
  const found = localAssetCandidates(appRoot, relative).find((candidate) =>
    fs.existsSync(candidate),
  );
  return found ?? null;
}

export function unlinkLocalAssetFile(
  appRoot: string,
  urlOrRelativePath: string,
): boolean {
  const fullPath = findLocalAssetFile(appRoot, urlOrRelativePath);
  if (!fullPath) return false;
  fs.unlinkSync(fullPath);
  return true;
}
