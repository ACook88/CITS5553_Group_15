import React, { useState } from "react";

function DataSelection() {
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);

  return (
    <div>
      <h2>Welcome, upload your files to get started</h2>
      <p><em>Please upload 2 files:</em></p>

      {/* File 1 */}
      <div>
        <label>
          Original File:{" "}
          <input
            type="file"
            accept=".parquet,.geoparquet,.zip"
            onChange={(e) => setFile1(e.target.files[0])}
          />
          {file1 && <span> ✅</span>}
        </label>
      </div>

      {/* File 2 */}
      <div style={{ marginTop: "10px" }}>
        <label>
          Imputed (DL) File:{" "}
          <input
            type="file"
            accept=".parquet,.geoparquet,.zip"
            onChange={(e) => setFile2(e.target.files[0])}
          />
          {file2 && <span> ✅</span>}
        </label>
      </div>
    </div>
  );
}

export default DataSelection;
