// frontend-esri/src/api/analysis.ts
// Helpers for calling analysis endpoints.
// Includes: runSummary, runPlotsData, runComparison, runComparisonFiles, exportPlots
// NOTE: This version pairs rows for comparison using the *user-selected* coordinate
// columns (northing/easting) and assay columns — matching the backend changes.

export type SummaryResponse = {
  original: {
    rows: number;
    cols: string[];
    value_stats?: Record<string, number>;
  };
  dl: {
    rows: number;
    cols: string[];
    value_stats?: Record<string, number>;
  };
};

export type SelectedColumns = {
  orig: { easting: string; northing: string; assay: string };
  dl: { easting: string; northing: string; assay: string };
};

export type ComparisonResponse = {
  n_pairs: number;
  preview: Array<Record<string, unknown>>;
  scatter: { x: number[]; y: number[]; x_label: string; y_label: string };
  residuals: { values: number[]; label: string };
  // present only when using /run_comparison_files
  run_token?: string;
};

// Some components in your app import PlotData from here; this maps to what we return.
export type PlotData = ComparisonResponse;

const API =
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

async function jsonOrThrow<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    // try to surface backend detail if present
    let detail: any = "";
    try {
      const j = await res.json();
      detail = j?.detail || JSON.stringify(j);
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

/**
 * Get high-level stats for each dataframe (rows, columns, optional value stats)
 */
export async function runSummary(
  run_token: string,
  value_column?: string
): Promise<SummaryResponse> {
  const res = await fetch(`${API}/api/analysis/run_summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_token, value_column }),
  });
  return jsonOrThrow<SummaryResponse>(res);
}

/**
 * Convenience wrapper used by some UIs that expect "plots data" preloaded.
 * Currently proxies to runSummary (extend if you add more plots server-side).
 */
export async function runPlotsData(
  run_token: string,
  opts?: { value_column?: string }
): Promise<SummaryResponse> {
  return runSummary(run_token, opts?.value_column);
}

/**
 * Main comparison call — pairs rows using the user-selected columns.
 * Returns scatter (orig vs dl) and residuals (dl - orig).
 */
export async function runComparison(
  run_token: string,
  selected: SelectedColumns,
  rounding: number = 6
): Promise<ComparisonResponse> {
  const res = await fetch(`${API}/api/analysis/run_comparison`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      run_token,
      orig_x: selected.orig.easting,
      orig_y: selected.orig.northing,
      orig_val: selected.orig.assay,
      dl_x: selected.dl.easting,
      dl_y: selected.dl.northing,
      dl_val: selected.dl.assay,
      rounding,
    }),
  });
  return jsonOrThrow<ComparisonResponse>(res);
}

/**
 * Optional helper if you want to POST the two CSVs directly instead of using a run_token.
 * (Useful for ad-hoc tests or when skipping the /api/data/columns step.)
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

/**
 * Export the merged comparison dataset (as base64 CSV payload).
 * Your UI can decode and trigger a download.
 */
export async function exportPlots(args: {
  run_token: string;
  filename?: string;
  selected: SelectedColumns;
  rounding?: number;
}): Promise<{ filename: string; bytes_b64: string; n_rows: number }> {
  const res = await fetch(`${API}/api/analysis/export_plots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      run_token: args.run_token,
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
