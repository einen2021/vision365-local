/**
 * Remote SGT (WFWSGT) extractor client.
 *
 * Request:  POST {NEXT_PUBLIC_SGT_EXTRACTOR}/extract  (multipart field "file")
 * Response: JSON with objects, labels, buttons, image → normalized for Import from SGT
 */

/** Build the /extract URL from env (origin or full path both OK). */
export function resolveSgtExtractorUrl() {
  const raw = String(process.env.NEXT_PUBLIC_SGT_EXTRACTOR || "").trim();
  if (!raw) return "";

  // Already points at /extract
  if (/\/extract\/?$/i.test(raw)) return raw.replace(/\/$/, "");

  return `${raw.replace(/\/$/, "")}/extract`;
}

/**
 * True when this row is a placeable fire device.
 * Needs Name (address) + deviceType, and must not be a TEXT_LABEL.
 */
export function isSgtDeviceRow(row) {
  if (!row || typeof row !== "object") return false;
  const name = String(row.Name ?? row.name ?? "").trim();
  const deviceType = String(row.deviceType ?? row.DeviceType ?? "").trim();
  if (!name || !deviceType) return false;
  if (deviceType.toUpperCase() === "TEXT_LABEL") return false;
  return true;
}

/** Skip CAD junk that looks like a Windows/UNC file path. */
export function isSgtFilePathLabel(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\\\\/.test(value)) return true;
  if (/\.(doc|docx|dxf|dwg|sgt|pdf|xls|xlsx)$/i.test(value)) return true;
  return false;
}

/** Prefer short_label for nav pins; fall back to target / label / name. */
export function getSgtButtonDisplayLabel(button) {
  const short = String(button?.short_label ?? button?.shortLabel ?? "").trim();
  if (short) return short;
  return String(button?.target ?? button?.label ?? button?.name ?? "").trim();
}

/** Stable slug for SGT placement ids (e.g. "ZONE A" → "zone_a"). */
export function slugSgtIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeDeviceRow(row = {}) {
  const x = toNumber(row.x ?? row.X);
  const y = toNumber(row.y ?? row.Y);
  const name = String(row.Name ?? row.name ?? "").trim();
  const deviceType = String(row.deviceType ?? row.DeviceType ?? "").trim();
  const objectName = String(row.object_name ?? row.objectName ?? "").trim();
  const pointType = String(row.pointType ?? row.PointType ?? "").trim();

  return {
    ...row,
    Name: name,
    name,
    deviceType,
    object_name: objectName,
    objectName,
    pointType,
    x,
    y,
  };
}

/**
 * Normalize a TEXT / annotation row from the API.
 * Marks it as TEXT_LABEL so it never passes isSgtDeviceRow.
 */
function normalizeLabelRow(row = {}) {
  const text = String(
    row.text ?? row.Text ?? row.label ?? row.object_name ?? row.objectName ?? "",
  ).trim();
  const layer = String(row.layer ?? row.Layer ?? "TEXT").trim() || "TEXT";

  return {
    ...row,
    text,
    object_name: text,
    label: text,
    Name: "",
    deviceType: "TEXT_LABEL",
    layer,
    x: toNumber(row.x ?? row.X ?? row.x1),
    y: toNumber(row.y ?? row.Y ?? row.y1),
    x1: toNumber(row.x1),
    y1: toNumber(row.y1),
    x2: toNumber(row.x2),
    y2: toNumber(row.y2),
  };
}

function normalizeButtonRow(row = {}) {
  return {
    ...row,
    short_label: String(row.short_label ?? row.shortLabel ?? "").trim(),
    target: String(row.target ?? row.label ?? row.name ?? "").trim(),
    x: toNumber(row.x ?? row.X),
    y: toNumber(row.y ?? row.Y),
  };
}

/** Decode a base64 or data-URL string into bytes. */
function bytesFromBase64(raw) {
  const base64 = String(raw || "").replace(/^data:[^;]+;base64,/, "");
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Turn API `image` into a Blob for local upload.
 * Supports:
 * - object with base64 / content_type / width / height
 * - object with remote url / href / src / image_url
 * - plain base64 or data-URL string
 */
async function bitmapFromImagePayload(image, fallbackFileName = "sgt-plan.png") {
  if (!image) return null;

  // Plain base64 / data-URL string
  if (typeof image === "string") {
    const bytes = bytesFromBase64(image);
    if (!bytes) return null;
    const contentType = image.startsWith("data:")
      ? image.slice(5, image.indexOf(";")) || "image/png"
      : "image/png";
    return {
      blob: new Blob([bytes], { type: contentType }),
      width: 0,
      height: 0,
      contentType,
      fileName: fallbackFileName,
    };
  }

  if (typeof image !== "object") return null;

  const contentType = String(
    image.content_type || image.contentType || "image/png",
  );
  const fileName = String(
    image.filename || image.fileName || fallbackFileName,
  );
  const width = toNumber(image.width) || 0;
  const height = toNumber(image.height) || 0;

  // Remote URL from extractor — fetch into a Blob
  const remoteUrl = String(
    image.url || image.href || image.src || image.image_url || image.imageUrl || "",
  ).trim();
  const hasBase64 = Boolean(image.base64 || image.data);

  if (remoteUrl && !hasBase64) {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      throw new Error(`Could not download SGT plan image (${response.status})`);
    }
    const blob = await response.blob();
    return {
      blob,
      width,
      height,
      contentType: blob.type || contentType,
      fileName,
    };
  }

  const bytes = bytesFromBase64(image.base64 || image.data || "");
  if (!bytes) return null;

  const blob = new Blob([bytes], { type: contentType });
  return { blob, width, height, contentType, fileName };
}

/**
 * Normalize extractor JSON into the shape Import from SGT expects.
 * @param {object} payload - raw API JSON
 * @param {string} [uploadName] - original .sgt filename (fallback for meta.filename)
 */
export async function normalizeSgtApiResponse(payload = {}, uploadName = "") {
  const objects = Array.isArray(payload.objects)
    ? payload.objects
    : Array.isArray(payload.devices)
      ? payload.devices
      : [];
  const labels = Array.isArray(payload.labels) ? payload.labels : [];
  const buttons = Array.isArray(payload.buttons) ? payload.buttons : [];

  const devices = objects.map(normalizeDeviceRow);
  const labelRows = labels.map(normalizeLabelRow);
  const buttonRows = buttons.map(normalizeButtonRow);

  const planFileName =
    (typeof payload.image === "object" &&
      (payload.image?.filename || payload.image?.fileName)) ||
    (uploadName ? String(uploadName).replace(/\.sgt$/i, ".png") : "sgt-plan.png");

  const planBitmap = await bitmapFromImagePayload(
    payload.image ?? payload.planBitmap ?? null,
    planFileName,
  );

  return {
    devices,
    labels: labelRows,
    buttons: buttonRows,
    planBitmap,
    bitmaps: planBitmap ? [planBitmap] : [],
    meta: {
      filename: payload.filename || uploadName || "",
      magic_ok: Boolean(payload.magic_ok ?? payload.magicOk),
      object_count:
        Number(payload.object_count ?? devices.length) || devices.length,
      label_count:
        Number(payload.label_count ?? labelRows.length) || labelRows.length,
      button_count:
        Number(payload.button_count ?? buttonRows.length) || buttonRows.length,
    },
  };
}

/**
 * Upload a .sgt file to the remote extractor and return normalized data.
 * POST multipart/form-data field "file" as application/octet-stream.
 *
 * Render free-tier apps spin down when idle — we wake the service first and
 * retry the extract while it cold-starts (often 30–90s).
 *
 * @param {File|Blob} file
 * @param {{ onStatus?: (message: string) => void }} [options]
 */
export async function extractSgtFile(file, options = {}) {
  const { onStatus } = options;
  const apiUrl = resolveSgtExtractorUrl();
  if (!apiUrl) {
    throw new Error(
      "NEXT_PUBLIC_SGT_EXTRACTOR is not set. Add it to .env (e.g. https://sgt-extractor.onrender.com) and restart the app.",
    );
  }

  const uploadName = file?.name || "plan.sgt";
  const buffer = await file.arrayBuffer();

  // Wake idle Render instance before uploading the heavy POST
  onStatus?.("Waking SGT extractor (may take up to a minute if idle)…");
  await wakeSgtExtractor(apiUrl, onStatus);

  onStatus?.("Uploading SGT to extractor…");
  const response = await postExtractWithRetry(apiUrl, buffer, uploadName, onStatus);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `SGT extractor failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const data = await response.json();
  return normalizeSgtApiResponse(data, uploadName);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Origin of the extractor (without /extract) for health wake-ups. */
function extractorOrigin(apiUrl) {
  try {
    const url = new URL(apiUrl);
    return url.origin;
  } catch {
    return String(apiUrl).replace(/\/extract\/?$/i, "");
  }
}

/** Status codes that usually mean the host is still spinning up. */
function isColdStartStatus(status) {
  return status === 502 || status === 503 || status === 504 || status === 520 || status === 521 || status === 522 || status === 524;
}

function isRetryableNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    error?.name === "AbortError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("fetch")
  );
}

/**
 * Ping the extractor origin until it answers (or we time out).
 * Cold starts on Render often take 30–90 seconds.
 */
async function wakeSgtExtractor(apiUrl, onStatus) {
  const origin = extractorOrigin(apiUrl);
  const maxWaitMs = 90_000;
  const started = Date.now();
  let attempt = 0;

  while (Date.now() - started < maxWaitMs) {
    attempt += 1;
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    if (attempt > 1) {
      onStatus?.(
        `Waiting for SGT extractor to start… (${elapsedSec}s)`,
      );
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      // Any HTTP response (even 404) means the process is up
      const res = await fetch(origin, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (res.ok || res.status < 500 || res.status === 404) {
        return;
      }
      if (!isColdStartStatus(res.status)) {
        // Unexpected but host is reachable — continue to POST
        return;
      }
    } catch (error) {
      if (!isRetryableNetworkError(error) && attempt > 3) {
        // Keep waiting for cold start network failures; only bail on weird errors later
      }
    }

    await sleep(Math.min(3000 + attempt * 500, 8000));
  }

  // Timed out waking — still try the extract POST (may succeed if wake was slow)
  onStatus?.("Extractor still starting — retrying upload…");
}

/**
 * POST /extract with retries while the service finishes cold-starting.
 * Rebuilds FormData each attempt so the body is never consumed twice.
 */
async function postExtractWithRetry(apiUrl, buffer, uploadName, onStatus) {
  const maxAttempts = 8;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const form = new FormData();
      form.append(
        "file",
        new Blob([buffer], { type: "application/octet-stream" }),
        uploadName,
      );

      const controller = new AbortController();
      // Allow long cold-start + parse time on first successful wake
      const timer = setTimeout(() => controller.abort(), 120_000);
      const response = await fetch(apiUrl, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) return response;

      if (isColdStartStatus(response.status) && attempt < maxAttempts) {
        onStatus?.(
          `Extractor waking up (HTTP ${response.status}) — retry ${attempt}/${maxAttempts}…`,
        );
        await sleep(Math.min(2000 * attempt, 10_000));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
        throw new Error(
          error?.name === "AbortError"
            ? "SGT extractor timed out while starting. Please try again in a moment."
            : `SGT extractor unreachable: ${error?.message || error}`,
        );
      }
      onStatus?.(
        `Waiting for SGT extractor… retry ${attempt}/${maxAttempts}`,
      );
      await sleep(Math.min(2500 * attempt, 12_000));
    }
  }

  throw lastError || new Error("SGT extractor failed after retries");
}
