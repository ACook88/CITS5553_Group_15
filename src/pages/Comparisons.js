
import React, { useState } from "react";
import styled from "styled-components";
import warningIcon from "../assets/icons/warning_icon.png"; 

// Styled components
const Container = styled.div`
  display: flex;
  gap: 2rem;
`;

const Controls = styled.div`
  flex: 0 0 250px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Select = styled.select`
  padding: 0.5rem;
`;

const Input = styled.input`
  padding: 0.5rem;
  width: 120px;
`;

const Button = styled.button`
  padding: 0.6rem 1rem;
  background: ${(props) => (props.disabled ? "#ccc" : "#007bff")};
  color: white;
  border: none;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  border-radius: 4px;
`;

const Visualization = styled.div`
  flex: 1;
  border: 1px solid #ccc;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
  min-height: 400px;
`;

const ToggleBar = styled.div`
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
`;

const ToggleButton = styled.button`
  padding: 0.5rem 1rem;
  background: ${(props) => (props.active ? "#007bff" : "#eee")};
  color: ${(props) => (props.active ? "white" : "black")};
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
`;

// Main component
function Comparisons() {
  const [method, setMethod] = useState("max");
  const [grid, setGrid] = useState(100);
  const [dataLoaded, setDataLoaded] = useState(false); // placeholder flag
  const [view, setView] = useState("original");

  return (
    <Container>
      {/* Left controls */}
      <Controls>
        <label>
          Method:
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="max">max</option>
            <option value="mean">mean</option>
            <option value="median">median</option>
            <option value="chi2">chi²</option>
          </Select>
        </label>

        <label>
          Grid (km²):
          <Input
            type="number"
            value={grid}
            onChange={(e) => setGrid(Number(e.target.value))}
          />
        </label>

        <Button disabled={!dataLoaded}>Run Comparisons</Button>
      </Controls>

      {/* Visualization area */}
      <div style={{ flex: 1 }}>
        <Visualization>
          {!dataLoaded ? (
            <>
              <img
                src={warningIcon}
                alt="Warning"
                style={{ width: "60px", marginBottom: "10px" }}
              />
              <p>No Data Loaded</p>
              <p>Please load data in Data Selection</p>
            </>
          ) : (
            <p>[Comparison results will be shown here]</p>
          )}
        </Visualization>

        {/* Toggle buttons */}
        <ToggleBar>
          <ToggleButton
            active={view === "original"}
            onClick={() => setView("original")}
          >
            Original
          </ToggleButton>
          <ToggleButton
            active={view === "dl"}
            onClick={() => setView("dl")}
          >
            DL
          </ToggleButton>
          <ToggleButton
            active={view === "comparison"}
            onClick={() => setView("comparison")}
          >
            Comparison
          </ToggleButton>
        </ToggleBar>
      </div>
    </Container>
  );
}

export default Comparisons;
