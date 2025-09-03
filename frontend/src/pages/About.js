import React from "react";

function About() {
  return (
    <div>
      <h1>Data Comparison &amp; Visualisation Tool</h1>
      <p>
        This application was developed as part of a university project to support
        geochemical exploration workflows. It is designed to help geoscientists
        and decision-makers quickly compare two datasets, highlighting similarities
        and differences in a clear spatial context.
      </p>

      <h3>The tool allows users to:</h3>
      <ul>
        <li>Upload datasets of original and DL values.</li>
        <li>Compare samples on a common grid.</li>
        <li>Apply different comparison methods to evaluate differences.</li>
        <li>
          Visualize results as coloured maps for each dataset and the computed comparison.
        </li>
        <li>
          Export the processed grid values to CSV for further analysis or use in
          other software.
        </li>
      </ul>

      <h3>Key Features</h3>
      <ul>
        <li>Multiple grid maps (Original, DL, Comparison)</li>
        <li>Multiple comparison algorithms</li>
        <li>Data export to CSV</li>
        <li>Workflow reset for new sessions</li>
      </ul>

      <h3>Technology</h3>
      <ul>
        <li><b>Frontend:</b> Web interface (React).</li>
        <li><b>Backend:</b> Python, with a modular comparison library.</li>
        <li><b>Storage:</b> Local Geoparquet file database.</li>
        <li><b>Deployment:</b> Dockerised for portability and consistency.</li>
      </ul>
    </div>
  );
}

export default About;
