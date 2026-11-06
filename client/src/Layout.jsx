import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import logo from './assets/logo.png';
import homeIcon from './assets/home.png';

const headerStyle = {
  backgroundColor: '#35384F',
  height: '60px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  color: 'white',
  fontWeight: 'bold',
  fontSize: '20px',
  padding: '0 16px',
  gap: '10px',
};

const leftGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  minWidth: 0,
};

const homeIconStyle = {
  height: '28px',
  width: 'auto',
  cursor: 'pointer',
};

const logoStyle = {
  height: '40px',
  width: 'auto',
};

const dateStyle = {
  fontSize: '14px',
  fontWeight: 'normal',
  whiteSpace: 'nowrap',
};

const brandStyle = {
  fontSize: '16px',
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

function getCurrentDate() {
  const d = new Date();
  return d.toLocaleDateString('ru-RU');
}

const mainDefault = {
  maxWidth: '1300px',
  margin: '0 auto',
  padding: '20px',
};

const mainFullScreen = {
  padding: '0',
  height: 'calc(100vh - 60px)',
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function Layout() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isCapturePage = location.pathname === '/defect-capture';

  const isFullScreen =
    location.pathname === '/report' ||
    location.pathname === '/daily-top' ||
    location.pathname === '/model-status' ||
    location.pathname === '/checkpoint-map' ||
    location.pathname === '/warranty' ||
    location.pathname === '/tl-map' ||
    location.pathname === '/drr-cp7-dashboard' ||
    location.pathname === '/drr-cp8-dashboard' ||
    location.pathname === '/drr-tl-dashboard' ||
    location.pathname === '/drr-pip-dashboard' ||
    location.pathname === '/remzone-work-status' ||
    location.pathname === '/vehicle-on-wheels' ||
    location.pathname === '/drr-wt-portal-old' ||
    location.pathname === '/drr-wt-portal' ||
    location.pathname === '/drr-cp6' ||
    location.pathname === '/drr-cp5' ||
    location.pathname === '/all-drr-dashboard' ||
    location.pathname === '/vrt-report' ||
    location.pathname === '/drr-shift-dashboard' ||
    location.pathname === '/brigade-report' ||
    location.pathname === '/defect-capture' ||
    location.pathname === '/drr-cp7-tup' ||
    location.pathname === '/daily-dashboard' ||
    location.pathname === '/drr-electronics-dashboard' ||
    

    location.pathname === '/inspection' ||


    location.pathname === '/line-defects-archive';

  return (
    <>
      <header style={headerStyle}>
        <div style={leftGroupStyle}>
          {isCapturePage ? (
            <>
              <img src={logo} alt="Logo" style={logoStyle} />
              <span style={brandStyle}>AGM - Quality</span>
            </>
          ) : (
            <>
              <Link to="/" title="На главную">
                <img src={homeIcon} alt="Home" style={homeIconStyle} />
              </Link>
              {!isMobile && <img src={logo} alt="Logo" style={logoStyle} />}
            </>
          )}
        </div>
        {!isMobile && !isCapturePage && <span>AGM - Quality</span>}
        <span style={dateStyle}>{getCurrentDate()}</span>
      </header>
      <main style={isFullScreen ? mainFullScreen : mainDefault}>
        <Outlet />
      </main>
    </>
  );
}