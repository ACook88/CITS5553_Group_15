import React from 'react';
import { Routes, Route } from 'react-router-dom';
import styled from 'styled-components';

import Sidebar from './components/Sidebar';
import DataSelection from './pages/DataSelection';
import Comparisons from './pages/Comparisons';
import Export from './pages/Export';
import About from './pages/About';
import Reset from './pages/Reset';

const SIDEBAR_WIDTH = '250px';

const Container = styled.div`
  display: flex;
  min-height: 100vh;
`;

const Main = styled.main`
  flex: 1;
  margin-left: ${SIDEBAR_WIDTH};
  padding: 1.5rem;
  padding-bottom: 4.5rem;
  background: #fafafa; /* very light grey */
  color: #000; /* dark text for contrast */
`;

const Footer = styled.footer`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 40px;
  background-color: #000;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  z-index: 1000;
  padding-left: ${SIDEBAR_WIDTH};
  box-shadow: 0 -2px 6px rgba(0,0,0,0.3);
`;

function App() {
  return (
    <>
      <Sidebar width={SIDEBAR_WIDTH} />
      <Container>
        <Main>
          <Routes>
            <Route path="/" element={<DataSelection />} />
            <Route path="/comparisons" element={<Comparisons />} />
            <Route path="/export" element={<Export />} />
            <Route path="/about" element={<About />} />
            <Route path="/reset" element={<Reset />} />
          </Routes>
        </Main>
      </Container>
      <Footer>
        © Group15 Capstone Project | All rights reserved
      </Footer>
    </>
  );
}

export default App;
