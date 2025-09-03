import React from "react";

function Export() {
  const handleExport = () => {
   
    window.location.href = "http://127.0.0.1:5000/export/comp-grid.csv";
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Export Data</h2>
      <p>Export a csv of the calculated grid values.</p>
      <button onClick={handleExport}>Export</button>
    </div>
  );
}

export default Export;
