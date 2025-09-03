import React from 'react';
import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import bgImage from '../assets/images/bg1.jpg';

// Import PNG icons
import mainIcon from '../assets/icons/main_icon.png';
import selectionIcon from '../assets/icons/selection_icon.png';
import comparisonsIcon from '../assets/icons/comparisons_icon.png';
import exportIcon from '../assets/icons/export_icon.png';
import aboutIcon from '../assets/icons/about_icon.png';
import resetIcon from '../assets/icons/reset_icon.png';

/**
 * The Sidebar component renders a vertical navigation bar on the left
 * side of the screen. Each navigation item is defined in the navItems
 * array below, which makes it easy to add/remove items later.
 */

const SidebarContainer = styled.aside`
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  width: ${({ width }) => width || '240px'};
  background: 
    linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.8)),
    url(${bgImage}) no-repeat center center;
  background-size: cover;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  z-index: 1001;
`;

const BrandWrapper = styled.div`
  display: flex;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const BrandIcon = styled.img`
  width: 48px;
  height: 48px;
  margin-right: 0.5rem;
`;

const BrandText = styled.h1`
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.2;
  margin: 0;
`;

const NavList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
`;

const NavItem = styled(NavLink)`
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  color: #fff;
  text-decoration: none;
  font-size: 0.9rem;
  transition: background 0.2s ease;

  &:hover {
    background-color: #3b3b3b;
  }

  &.active {
    background-color: #6390AC; /* highlight blue */
  }

  img {
    margin-right: 0.75rem;
    width: 30px;
    height: 30px;
    object-fit: contain;
  }
`;

const ItemLabel = styled.span`
  flex: 1;
  white-space: nowrap;
`;

// Navigation structure using PNG icons
const navItems = [
  { path: '/', label: 'Data Selection', icon: selectionIcon },
  { path: '/comparisons', label: 'Comparisons', icon: comparisonsIcon },
  { path: '/export', label: 'Export', icon: exportIcon },
  { path: '/about', label: 'About', icon: aboutIcon },
  { path: '/reset', label: 'Reset', icon: resetIcon },
];

function Sidebar({ width }) {
  return (
    <SidebarContainer width={width}>
      <BrandWrapper>
        <BrandIcon src={mainIcon} alt="Main Logo" />
        <BrandText>Data Comparison &amp; Visualisation Tool</BrandText>
      </BrandWrapper>
      <NavList>
        {navItems.map(({ path, label, icon }) => (
          <li key={path}>
            <NavItem to={path} end={path === '/'}>
              <img src={icon} alt={label} />
              <ItemLabel>{label}</ItemLabel>
            </NavItem>
          </li>
        ))}
      </NavList>
    </SidebarContainer>
  );
}

export default Sidebar;
