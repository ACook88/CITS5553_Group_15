import React from "react";

function Reset({ onReset }) {
  return (
    <div>
      <h2>Reset Project</h2>
      <p>Clear all data and reset graphs?</p>
      <button onClick={onReset}>Reset</button>
    </div>
  );
}

export default Reset;
