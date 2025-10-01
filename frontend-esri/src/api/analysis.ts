// frontend-esri/src/api/analysis.ts
// Helpers for calling analysis endpoints.

export type SummaryResponse = {
  original: { rows: number; cols: string[]; value_stats?: Record<string, number> };
  dl:       { rows: number; cols: string[]; value_stats?: Record<string, number> };
};

export type SelectedColumns = {
  orig: { easting: string; northing: string; assay: string };
  dl:   { easting: string; northing: string; assay: string };
};

export type ComparisonResponse = {
  n_pairs: number;
  preview: Array<Record<string, unknown>>;
  scatter: { x: number[]; y: number[]; x_label: string; y_label: string };
  residuals: { values: number[]; label: string };
  run_token?: string;
};

export type PlotData = ComparisonResponse;

const API = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

function getStoredRunToken(): string | null {
  try {
    return localStorage.getItem("run_token");
  } catch {
    return null;
  }
}

async function jsonOrThrow<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.detail || JSON.stringify(j);
    } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function runSummary(
  run_token?: string,
  value_column?: string
): Promise<SummaryResponse> {
  const token = run_token || getStoredRunToken();
  if (!token) throw new Error("No run_token available. Load data first.");

  const res = await fetch(`${API}/api/analysis/run_summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_token: token, value_column }),
  });
  return jsonOrThrow<SummaryResponse>(res);
}

/**
 * Main comparison call — pairs rows using the user-selected columns.
 * If run_token is not provided, it will be read from localStorage.
 */
export async function runComparison(
  run_token: string | undefined,
  selected: SelectedColumns,
  rounding: number = 6
): Promise<ComparisonResponse> {
  const token = run_token || getStoredRunToken();
  if (!token) throw new Error("No run_token available. Load data first.");

  // Guard: fail early if UI selections are missing
  const req: Record<string, string | number> = {
    run_token: token,
    orig_x: selected?.orig?.easting ?? "",
    orig_y: selected?.orig?.northing ?? "",
    orig_val: selected?.orig?.assay ?? "",
    dl_x: selected?.dl?.easting ?? "",
    dl_y: selected?.dl?.northing ?? "",
    dl_val: selected?.dl?.assay ?? "",
    rounding,
  };
  for (const k of ["orig_x","orig_y","orig_val","dl_x","dl_y","dl_val"]) {
    if (!String(req[k]).trim()) {
      throw new Error(`Missing required selection: ${k}`);
    }
  }

  const res = await fetch(`${API}/api/analysis/run_comparison`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return jsonOrThrow<ComparisonResponse>(res);
}

/**
 * Compatibility wrapper for older code paths.
 */
export async function runPlotsData(
  run_token: string | undefined,
  selected: SelectedColumns,
  rounding: number = 6
): Promise<PlotData> {
  return runComparison(run_token, selected, rounding);
}

/**
 * Post two CSVs directly (bypasses run_token). Handy for testing.
 */
export async function runComparisonFiles(
  originalFile: File,
  dlFile: File,
  selected: SelectedColumns,
  rounding: number = 6
): Promise<ComparisonResponse> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("orig_x", selected.orig.easting);
  form.append("orig_y", selected.orig.northing);
  form.append("orig_val", selected.orig.assay);
  form.append("dl_x", selected.dl.easting);
  form.append("dl_y", selected.dl.northing);
  form.append("dl_val", selected.dl.assay);
  form.append("rounding", String(rounding));

  const res = await fetch(`${API}/api/analysis/run_comparison_files`, {
    method: "POST",
    body: form,
  });
  return jsonOrThrow<ComparisonResponse>(res);
}

export async function exportPlots(args: {
  run_token?: string;
  filename?: string;
  selected: SelectedColumns;
  rounding?: number;
}): Promise<{ filename: string; bytes_b64: string; n_rows: number }> {
  const token = args.run_token || getStoredRunToken();
  if (!token) throw new Error("No run_token available. Load data first.");

  const res = await fetch(`${API}/api/analysis/export_plots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      run_token: token,
      filename: args.filename || "comparison_export.csv",
      orig_x: args.selected.orig.easting,
      orig_y: args.selected.orig.northing,
      orig_val: args.selected.orig.assay,
      dl_x: args.selected.dl.easting,
      dl_y: args.selected.dl.northing,
      dl_val: args.selected.dl.assay,
      rounding: args.rounding ?? 6,
    }),
  });
  return jsonOrThrow(res);
}
