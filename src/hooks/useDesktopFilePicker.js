"use client";

import { useCallback } from "react";
import { isDesktop } from "@/lib/platform";

/**
 * Native file picker for desktop — falls back to browser input on web.
 * @param {object} options
 * @param {boolean} [options.multiple=false]
 * @param {string[]} [options.filters] - e.g. ["image/*", "application/pdf"]
 */
export function useDesktopFilePicker({ multiple = false, filters = [] } = {}) {
  const pickFiles = useCallback(async () => {
    if (isDesktop()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple,
          filters: filters.length
            ? [{ name: "Files", extensions: filters.map((f) => f.replace("*.", "").replace("*", "")) }]
            : undefined,
        });
        if (!selected) return [];
        const paths = Array.isArray(selected) ? selected : [selected];

        const { readFile } = await import("@tauri-apps/plugin-fs");
        const files = [];
        for (const filePath of paths) {
          const bytes = await readFile(filePath);
          const name = filePath.split(/[/\\]/).pop() || "file";
          const blob = new Blob([bytes]);
          files.push(new File([blob], name));
        }
        return files;
      } catch (err) {
        console.warn("[useDesktopFilePicker]", err);
        return [];
      }
    }

    // Web fallback: programmatic file input
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = multiple;
      if (filters.length) input.accept = filters.join(",");
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
  }, [multiple, filters]);

  return { pickFiles };
}
