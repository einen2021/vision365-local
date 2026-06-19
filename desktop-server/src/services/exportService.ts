import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { type AppPaths, safePath } from "./storageService";
import { readDb } from "../db/documentStore";

export type ExportFormat = "csv" | "xlsx" | "json" | "pdf";

export interface ExportResult {
  filename: string;
  path: string;
  format: ExportFormat;
  size: number;
}

/** Export a collection from the document store */
export async function exportCollection(
  paths: AppPaths,
  collectionPath: string[],
  format: ExportFormat,
  filename?: string
): Promise<ExportResult> {
  const db = await readDb();
  const segments = collectionPath;
  let items: Record<string, unknown>[] = [];

  if (segments.length === 1) {
    const collection = db[segments[0]] as Record<string, unknown> | undefined;
    if (collection && typeof collection === "object") {
      items = Object.entries(collection).map(([id, data]) => ({
        id,
        ...(typeof data === "object" && data !== null ? (data as Record<string, unknown>) : { value: data }),
      }));
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = filename || `${segments.join("_")}_${timestamp}`;

  if (format === "json") {
    return writeJsonExport(paths, baseName, items);
  }
  if (format === "csv" || format === "xlsx") {
    return writeSpreadsheetExport(paths, baseName, items, format);
  }

  return writeJsonExport(paths, `${baseName}_pdf_fallback`, items);
}

/** Export entire database */
export async function exportFullDatabase(
  paths: AppPaths,
  format: ExportFormat = "json"
): Promise<ExportResult> {
  const db = await readDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `full_export_${timestamp}`;

  if (format === "json") {
    return writeJsonExport(paths, baseName, db);
  }

  const flatItems = flattenDbForExport(db);
  return writeSpreadsheetExport(paths, baseName, flatItems, format === "xlsx" ? "xlsx" : "csv");
}

function writeJsonExport(
  paths: AppPaths,
  baseName: string,
  data: unknown
): ExportResult {
  const filename = `${baseName}.json`;
  const filePath = safePath(paths.exports, filename);
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, "utf-8");
  const stat = fs.statSync(filePath);

  return { filename, path: filePath, format: "json", size: stat.size };
}

function writeSpreadsheetExport(
  paths: AppPaths,
  baseName: string,
  items: Record<string, unknown>[],
  format: "csv" | "xlsx"
): ExportResult {
  const worksheet = XLSX.utils.json_to_sheet(items);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export");

  const filename = `${baseName}.${format}`;
  const filePath = safePath(paths.exports, filename);
  XLSX.writeFile(workbook, filePath);
  const stat = fs.statSync(filePath);

  return { filename, path: filePath, format, size: stat.size };
}

function flattenDbForExport(db: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(db)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [docId, docData] of Object.entries(value as Record<string, unknown>)) {
        rows.push({
          collection: key,
          id: docId,
          ...(typeof docData === "object" && docData !== null
            ? (docData as Record<string, unknown>)
            : { value: docData }),
        });
      }
    }
  }

  return rows;
}
