// frontend-esri/src/api/data.ts
// Same host base via VITE_API_BASE; keep /api/... in paths.

export type ColumnsResponse = {
  original_columns: string[];
  dl_columns: string[];
  run_token: string;
};

const API =
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

export async function fetchColumns(
  originalFile: File,
  dlFile: File
): Promise<ColumnsResponse> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);

  const res = await fetch(`${API}/api/data/columns`, {
    method: "POST",
    body: form,
  });

  // bubble up readable errors
  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = j?.detail || JSON.stringify(j);
    } catch {}
    throw new Error(`HTTP ${res.status} — ${msg || "Failed to fetch columns"}`);
  }

  const data = (await res.json()) as ColumnsResponse;

  // Persist the token so subsequent analysis calls don't need to pass it explicitly
  if (data?.run_token) {
    try {
      localStorage.setItem("run_token", data.run_token);
    } catch {
      /* ignore storage failures */
    }
  }

  return data;
}
