const API = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export type Summary = {
  count: number;
  mean: number | null;
  median: number | null;
  max: number | null;
  std: number | null;
};

export async function runSummary(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string
): Promise<{ original: Summary; dl: Summary }> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("original_assay", originalAssay);
  form.append("dl_assay", dlAssay);

  const res = await fetch(`${API}/api/analysis/summary`, {
    method: "POST",
    body: form,
  });

  // Defensive: read as text first to avoid JSON parse crashes masking the real error
  const text = await res.text();

  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!data?.original || !data?.dl) {
    throw new Error("Malformed response: missing 'original' or 'dl'");
  }

  return data;
}

export async function runPlots(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string
): Promise<{ original_png: string; dl_png: string; qq_png: string }> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("original_assay", originalAssay);
  form.append("dl_assay", dlAssay);

  const res = await fetch(`${API}/api/analysis/plots`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type PlotData = {
  x: number[];
  y: number[];
  bin_edges?: number[];
  title: string;
  xlabel: string;
  ylabel: string;
  log_x: boolean;
  log_y?: boolean;
  line_x?: number[];
  line_y?: number[];
};

export type PlotsDataResponse = {
  original_data: PlotData;
  dl_data: PlotData;
  qq_data: PlotData;
};

export async function runPlotsData(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string
): Promise<PlotsDataResponse> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("original_assay", originalAssay);
  form.append("dl_assay", dlAssay);

  const res = await fetch(`${API}/api/analysis/plots-data`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runComparison(
  originalFile: File,
  dlFile: File,
  map: {
    oN: string;
    oE: string;
    oA: string;
    dN: string;
    dE: string;
    dA: string;
  },
  method: "mean" | "median" | "max",
  gridSize: number
) {
  const fd = new FormData();
  fd.append("original", originalFile);
  fd.append("dl", dlFile);

  // MUST match FastAPI field names exactly
  fd.append("original_northing", map.oN);
  fd.append("original_easting", map.oE);
  fd.append("original_assay", map.oA);
  fd.append("dl_northing", map.dN);
  fd.append("dl_easting", map.dE);
  fd.append("dl_assay", map.dA);

  fd.append("method", method);
  fd.append("grid_size", String(gridSize));

  const res = await fetch(`${API}/api/analysis/comparison`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Comparison failed (${res.status})`);
  }
  return res.json();
}

export async function exportPlots(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string,
  selectedPlots: Record<string, boolean>,
  // Optional parameters for heatmap generation
  originalNorthing?: string,
  originalEasting?: string,
  dlNorthing?: string,
  dlEasting?: string,
  method?: string,
  gridSize?: number,
  // Legend configuration parameters
  legendConfig?: {
    original: { min: number | null; max: number | null; auto: boolean };
    dl: { min: number | null; max: number | null; auto: boolean };
    comparison: { min: number | null; max: number | null; auto: boolean };
  }
): Promise<Blob> {
  const formData = new FormData();
  formData.append("original_file", originalFile);
  formData.append("dl_file", dlFile);
  formData.append("original_assay", originalAssay);
  formData.append("dl_assay", dlAssay);
  formData.append("selected_plots", JSON.stringify(selectedPlots));
  
  // Add heatmap parameters if provided
  if (originalNorthing) formData.append("original_northing", originalNorthing);
  if (originalEasting) formData.append("original_easting", originalEasting);
  if (dlNorthing) formData.append("dl_northing", dlNorthing);
  if (dlEasting) formData.append("dl_easting", dlEasting);
  if (method) formData.append("method", method);
  if (gridSize !== undefined) formData.append("grid_size", gridSize.toString());
  
  // Add legend configuration if provided
  if (legendConfig) {
    formData.append("legend_config", JSON.stringify(legendConfig));
  }

  const response = await fetch(`${API}/api/analysis/export/plots`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Export plots failed");
  }

  return response.blob();
}

export async function exportGridCSV(
  originalFile: File,
  dlFile: File,
  mapping: {
    oN: string;
    oE: string;
    oA: string;
    dN: string;
    dE: string;
    dA: string;
  },
  method: "max" | "mean" | "median",
  gridSize: number
): Promise<Blob> {
  const formData = new FormData();
  formData.append("original_file", originalFile);
  formData.append("dl_file", dlFile);
  formData.append("original_northing", mapping.oN);
  formData.append("original_easting", mapping.oE);
  formData.append("original_assay", mapping.oA);
  formData.append("dl_northing", mapping.dN);
  formData.append("dl_easting", mapping.dE);
  formData.append("dl_assay", mapping.dA);
  formData.append("method", method);
  formData.append("grid_size", gridSize.toString());

  const response = await fetch(`${API}/api/analysis/export/grid-csv`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Export CSV failed");
  }

  return response.blob();
}
 
 