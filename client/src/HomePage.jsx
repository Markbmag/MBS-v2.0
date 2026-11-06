import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import tablePreview from './assets/table-preview.png';
import dailyTopPreview from './assets/daily-top-preview.png';
import modelStatusPreview from './assets/123.png';
import checkpointMapPreview from './assets/321.png';
import sgpAuditPreview from './assets/sgp.png';
import mppWeeklyPreview from './assets/mppweek.png';
import partDefectPreview from './assets/search.png';
import externalReportPreview from './assets/kulik.png';
import drrReportPreview from './assets/drrall.png';
import dailyDashboardPreview from './assets/dailyq.png';
import externalDReportPreview from './assets/dim.png';
import warrantyPreview from './assets/waran.png';
import tlMapPreview from './assets/tlmap.png';
import HoldsSgpPage from './assets/hold.png';
import sgpManagementPreview from './assets/cp8.png';
import DrrCp7DashboardPage from './assets/cp7drr.png';
import cp7historyPreview from './assets/cp7hist.png';
import DrrCp8DashboardPage from './assets/cp8drr.png';
import drrTestlinePreview from './assets/tldrr.png';
import DrrPIPDashboardPage from './assets/drrpip.png';
import electronicsPreview from './assets/elec.png';
import brigPreview from './assets/briga.png';
import RemPreview from './assets/remzs.png';
import VehPreview from './assets/repai.png';
import drrWtPortalPreview from './assets/cp8drr.png';
import drrCp6Preview from './assets/drrcp6.png';
import drrCp5Preview from './assets/drrcp5.png';
import allDrrPreview from './assets/alldrrcomp.png';
import vrtPreview from './assets/vrt.png';
import drrShiftPreview from './assets/drrshift.png';
import defectCapturePreview from './assets/defph.png';
import lineDefectsArchivePreview from './assets/archph.png';
import reppsPreview from './assets/repps.png';
import voltageSpcPreview from './assets/volt.png';
import repelecPreview from './assets/repelec.png'; 
import drrElectronicsPreview from './assets/dshelec.png';

// ====== СТИЛИ ======
const sectionStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 20,
  padding: 32,
  marginBottom: 32,
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.04), 0 8px 10px -6px rgba(0, 0, 0, 0.02)',
  border: '1px solid #F0F0F5',
  transition: 'opacity 0.4s ease, transform 0.4s ease, max-height 0.5s ease, margin-bottom 0.4s ease, padding 0.4s ease',
  overflow: 'hidden',
};

const headingStyle = {
  color: '#1F2937',
  fontSize: 24,
  fontWeight: 700,
  marginBottom: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 24,
};

const tabBarStyle = {
  display: 'flex',
  gap: 6,
  marginBottom: 24,
  backgroundColor: '#E5E7EB',
  borderRadius: 14,
  padding: 6,
  width: 'fit-content',
};

const tabStyle = (active) => ({
  padding: '10px 28px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 15,
  background: active ? '#FFFFFF' : 'transparent',
  color: active ? '#111827' : '#6B7280',
  cursor: 'pointer',
  boxShadow: active ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  whiteSpace: 'nowrap',
});

const searchContainerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 28,
  width: '100%',
  maxWidth: 600,
  position: 'relative',
};

const searchInputStyle = {
  width: '100%',
  padding: '14px 20px 14px 48px',
  borderRadius: 14,
  border: '1px solid #E5E7EB',
  fontSize: 15,
  background: '#FFFFFF',
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
};

const searchIconStyle = {
  position: 'absolute',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 18,
  color: '#9CA3AF',
  pointerEvents: 'none',
};

const clearButtonStyle = {
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  border: 'none',
  background: 'transparent',
  color: '#9CA3AF',
  fontSize: 18,
  cursor: 'pointer',
  padding: '4px',
  borderRadius: '50%',
  transition: 'background 0.2s, color 0.2s',
};

const getCardStyle = (isHovered, accentColor) => ({
  position: 'relative',
  width: '100%',
  borderRadius: 16,
  overflow: 'hidden',
  boxShadow: isHovered
    ? '0 20px 30px -10px rgba(0,0,0,0.12)'
    : '0 4px 10px rgba(0,0,0,0.04)',
  transition: 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1.2), box-shadow 0.3s ease',
  transform: isHovered ? 'translateY(-8px)' : 'translateY(0)',
  backgroundColor: '#FFFFFF',
  textDecoration: 'none',
  color: 'inherit',
  display: 'block',
  border: `1px solid ${isHovered ? accentColor : '#F3F4F6'}`,
});

const thumbnailStyle = {
  backgroundColor: '#F9FAFB',
  height: 150,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderBottom: '1px solid #F3F4F6',
};

const getCaptionStyle = (isHovered, accentColor) => ({
  backgroundColor: isHovered ? accentColor : '#374151',
  height: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: '0.3px',
  transition: 'background-color 0.3s ease',
});

const favoriteButtonStyle = (isFavorite, isHovered) => ({
  position: 'absolute',
  top: 10,
  right: 10,
  width: 32,
  height: 32,
  borderRadius: '50%',
  border: 'none',
  background: isFavorite ? '#FBBF24' : 'rgba(255,255,255,0.9)',
  color: isFavorite ? '#FFFFFF' : '#9CA3AF',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  fontWeight: 700,
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  transition: 'all 0.2s ease',
  zIndex: 5,
  opacity: isFavorite || isHovered ? 1 : 0,
  transform: isFavorite || isHovered ? 'scale(1)' : 'scale(0.8)',
});

// ====== КОМПОНЕНТ КАРТОЧКИ ======
function ReportCard({ to, imgSrc, caption, accentColor = '#2563EB', isFavorite, onToggleFavorite }) {
  const [isHovered, setIsHovered] = useState(false);
  const cardStyle = getCardStyle(isHovered, accentColor);
  const captionStyle = getCaptionStyle(isHovered, accentColor);

  const isExternal = to.startsWith('http');

  const content = (
    <div style={thumbnailStyle}>
      <img
        src={imgSrc}
        alt={caption}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transition: 'transform 0.4s ease',
          transform: isHovered ? 'scale(1.04)' : 'scale(1)',
        }}
      />
    </div>
  );

  const captionBlock = <div style={captionStyle}>{caption}</div>;

  const favoriteButton = (
    <button
      style={favoriteButtonStyle(isFavorite, isHovered)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite(to);
      }}
      title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
    >
      ★
    </button>
  );

  const innerContent = (
    <>
      {favoriteButton}
      {content}
      {captionBlock}
    </>
  );

  if (isExternal) {
    return (
      <a
        href={to}
        target="_blank"
        rel="noopener noreferrer"
        style={cardStyle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {innerContent}
      </a>
    );
  }

  return (
    <Link
      to={to}
      style={cardStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {innerContent}
    </Link>
  );
}

// ====== АНИМИРОВАННАЯ СЕКЦИЯ ======
function AnimatedSection({ title, icon, iconBg, iconColor, children, visible }) {
  const [shouldRender, setShouldRender] = useState(visible);
  const [isAnimating, setIsAnimating] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      const timer = setTimeout(() => {
        setIsAnimating(true);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!shouldRender) return null;

  return (
    <div style={{
      ...sectionStyle,
      opacity: isAnimating ? 1 : 0,
      transform: isAnimating ? 'translateY(0)' : 'translateY(20px)',
      maxHeight: isAnimating ? '3000px' : '0',
      marginBottom: isAnimating ? 32 : 0,
      padding: isAnimating ? 32 : '0 32px',
    }}>
      <h2 style={headingStyle}>
        <span style={{
          background: iconBg,
          padding: '8px 14px',
          borderRadius: 8,
          color: iconColor,
          fontSize: 18,
        }}>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ====== ОСНОВНОЙ КОМПОНЕНТ ======
export default function HomePage() {
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('home_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('home_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (to) => {
    setFavorites(prev => prev.includes(to) ? prev.filter(item => item !== to) : [...prev, to]);
  };

  const showReports = activeTab === 'all' || activeTab === 'reports';
  const showServices = activeTab === 'all' || activeTab === 'services';
  const showDrr = activeTab === 'all' || activeTab === 'drr';

  const allReportCards = [
    { to: "/report", imgSrc: tablePreview, caption: "Top DRR Board", accentColor: "#3B82F6" },
    { to: "/daily-top", imgSrc: dailyTopPreview, caption: "Daily Top CP7/CP8", accentColor: "#8B5CF6" },
    { to: "/model-status", imgSrc: modelStatusPreview, caption: "Model Status", accentColor: "#F59E0B" },
    { to: "/mpp-weekly-top", imgSrc: mppWeeklyPreview, caption: "DRR Defects Top CP7/СP8", accentColor: "#10B981" },
    { to: "/drr-report", imgSrc: drrReportPreview, caption: "DRR Report", accentColor: "#3B82F6" },
    { to: "/daily-dashboard", imgSrc: dailyDashboardPreview, caption: "Daily Dashboard", accentColor: "#F59E0B" },
    { to: "/tl-map", imgSrc: tlMapPreview, caption: "TL Map", accentColor: "#14B8A6" },
    { to: "/drr-cp7-dashboard", imgSrc: DrrCp7DashboardPage, caption: "DRR CP7 Dashboard", accentColor: "#6366F1" },
    { to: "/drr-cp7-history", imgSrc: cp7historyPreview, caption: "DRR CP7 History", accentColor: "#6366F1" },
    //{ to: "/drr-cp8-dashboard", imgSrc: DrrCp8DashboardPage, caption: "DRR CPFinal Dashboard", accentColor: "#8B5CF6" },
    { to: "/drr-tl-dashboard", imgSrc: drrTestlinePreview, caption: "DRR ADAS Dashboard", accentColor: "#0ea5e9" },
    { to: "/drr-pip-dashboard", imgSrc: DrrPIPDashboardPage, caption: "DRR PIP Dashboard", accentColor: "#0EA5E9" },
    { to: "/drr-cp7-tup", imgSrc: DrrCp7DashboardPage, caption: "DRR CP7 (Touch Up)", accentColor: "#F59E0B" },
    { to: "/drr-wt-portal", imgSrc: drrWtPortalPreview, caption: "DRR CPFinal Dashboard", accentColor: "#0EA5E9" },//это новый спфинал
    { to: "/defect-electronics-top", imgSrc: electronicsPreview, caption: "Electronics Defects Top", accentColor: "#8B5CF6" },
    { to: "/remzone-work-status", imgSrc: RemPreview, caption: "Remzone Work Status", accentColor: "#8B5CF6" },
    { to: "/vehicle-on-wheels", imgSrc: VehPreview, caption: "Vehicle on Wheels", accentColor: "#e22910" },
    { to: "/drr-cp6", imgSrc: drrCp6Preview, caption: "DRR CP6 Dashboard", accentColor: "#0EA5E9" },
    { to: "/drr-cp5", imgSrc: drrCp5Preview, caption: "DRR CP5 Dashboard", accentColor: "#8B5CF6" },
    { to: "/drr-electronics-dashboard", imgSrc: drrElectronicsPreview, caption: "DRR Electronics Dashboard", accentColor: "#8B5CF6" },
    { to: "/all-drr-dashboard", imgSrc: allDrrPreview, caption: "All DRR Dashboard", accentColor: "#0EA5E9" },
    { to: "/drr-shift-dashboard", imgSrc: drrShiftPreview, caption: "DRR Shift Dashboard", accentColor: "#7C3AED" },
    { to: "/repps-report", imgSrc: reppsPreview, caption: "REPPS Report", accentColor: "#EC4899" },
    { to: "/voltage-spc", imgSrc: voltageSpcPreview, caption: "Voltage SPC Report", accentColor: "#F59E0B" },
    { to: "/repelec-report", imgSrc: repelecPreview, caption: "REPELEC Report", accentColor: "#F59E0B" },
  ];

  const allServiceCards = [
    { to: "/sgp-audit", imgSrc: sgpAuditPreview, caption: "СГП Audit", accentColor: "#10B981" },
    { to: "/sgp-management", imgSrc: sgpManagementPreview, caption: "СГП Management", accentColor: "#10B981" },
    { to: "/part-defect-search", imgSrc: partDefectPreview, caption: "Part/Defect Search", accentColor: "#3B82F6" },
    { to: "http://10.27.195.25:5174/time-at-points", imgSrc: externalDReportPreview, caption: "Chekpoint Passage", accentColor: "#F59E0B" },
    { to: "/warranty", imgSrc: warrantyPreview, caption: "Warranty", accentColor: "#10B981" },
    { to: "/holds-sgp", imgSrc: HoldsSgpPage, caption: "Holds СГП", accentColor: "#EF4444" },
    { to: "http://10.27.195.16/reports/024", imgSrc: externalReportPreview, caption: "DRR по заводу", accentColor: "#EF4444" },
    { to: "/brigade-report", imgSrc: brigPreview, caption: "Brigade Report Service", accentColor: "#3B82F6" },
    { to: "/vrt-report", imgSrc: vrtPreview, caption: "VRT Report Service", accentColor: "#7C3AED" },
    { to: "http://10.27.195.25:30000/defect-capture", imgSrc: defectCapturePreview, caption: "Defect Capture", accentColor: "#10B981" },
    { to: "http://10.27.195.25:30000/line-defects-archive", imgSrc: lineDefectsArchivePreview, caption: "Line Defects Archive", accentColor: "#10B981" }
  ];

  // DRR-отчёты выносим в отдельную вкладку
  const DRR_ROUTES = [
    '/drr-cp7-dashboard',
    '/drr-wt-portal',
    '/drr-tl-dashboard',
    '/vehicle-on-wheels',
    '/drr-pip-dashboard',
    '/drr-cp6',
    '/drr-cp5',
    '/all-drr-dashboard',
    '/drr-shift-dashboard',
    '/drr-cp7-tup',
    '/drr-electronics-dashboard'
  ];

  const allDrrCards = allReportCards.filter(card => DRR_ROUTES.includes(card.to));

  const filterCards = (cards) => {
    return cards.filter(card => card.caption.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  };

  // Общие "Отчёты" без DRR-карточек (чтобы не было дублирования)
  const filteredReportCards = filterCards(allReportCards)
    .filter(card => !DRR_ROUTES.includes(card.to));
  const filteredServiceCards = filterCards(allServiceCards);
  const filteredDrrCards = filterCards(allDrrCards);

  const favoriteReportCards = filteredReportCards.filter(card => favorites.includes(card.to));
  const favoriteServiceCards = filteredServiceCards.filter(card => favorites.includes(card.to));
  const favoriteDrrCards = filteredDrrCards.filter(card => favorites.includes(card.to));

  return (
    <div style={{ padding: 40, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>

      {/* Табы */}
      <div style={tabBarStyle}>
        <button onClick={() => setActiveTab('all')} style={tabStyle(activeTab === 'all')}>
          Все
        </button>
        <button onClick={() => setActiveTab('reports')} style={tabStyle(activeTab === 'reports')}>
          📊 Отчеты
        </button>
        <button onClick={() => setActiveTab('services')} style={tabStyle(activeTab === 'services')}>
          🛠️ Сервисы
        </button>
        <button onClick={() => setActiveTab('drr')} style={tabStyle(activeTab === 'drr')}>
          ⚙️ Отчеты DRR
        </button>
      </div>

      {/* Поиск */}
      <div style={searchContainerStyle}>
        <span style={searchIconStyle}>🔍</span>
        <input
          type="text"
          placeholder="Поиск отчёта или сервиса..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={searchInputStyle}
        />
        {searchTerm && (
          <button
            style={clearButtonStyle}
            onClick={() => setSearchTerm('')}
          >
            ✕
          </button>
        )}
      </div>

      {/* Избранное */}
      {(favoriteReportCards.length > 0 || favoriteServiceCards.length > 0 || favoriteDrrCards.length > 0) && (
        <AnimatedSection
          title="Избранное"
          icon="⭐"
          iconBg="#FEF3C7"
          iconColor="#D97706"
          visible={true}
        >
          <div style={gridStyle}>
            {favoriteDrrCards.map(card => (
              <ReportCard
                key={card.to}
                {...card}
                isFavorite={true}
                onToggleFavorite={toggleFavorite}
              />
            ))}
            {favoriteReportCards.map(card => (
              <ReportCard
                key={card.to}
                {...card}
                isFavorite={true}
                onToggleFavorite={toggleFavorite}
              />
            ))}
            {favoriteServiceCards.map(card => (
              <ReportCard
                key={card.to}
                {...card}
                isFavorite={true}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </AnimatedSection>
      )}

      {/* Секция "Отчёты" (без DRR) */}
      <AnimatedSection
        title="Отчёты"
        icon="📊"
        iconBg="#EEF2FF"
        iconColor="#2563EB"
        visible={showReports && filteredReportCards.length > 0}
      >
        <div style={gridStyle}>
          {filteredReportCards.map(card => (
            <ReportCard
              key={card.to}
              {...card}
              isFavorite={favorites.includes(card.to)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
        {filteredReportCards.length === 0 && (
          <p style={{ textAlign: 'center', color: '#6B7280', margin: '20px 0' }}>
            Ничего не найдено
          </p>
        )}
      </AnimatedSection>

      {/* Секция "Отчеты DRR" */}
      <AnimatedSection
        title="Отчеты DRR"
        icon="⚙️"
        iconBg="#EDE9FE"
        iconColor="#7C3AED"
        visible={showDrr && filteredDrrCards.length > 0}
      >
        <div style={gridStyle}>
          {filteredDrrCards.map(card => (
            <ReportCard
              key={card.to}
              {...card}
              isFavorite={favorites.includes(card.to)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
        {filteredDrrCards.length === 0 && (
          <p style={{ textAlign: 'center', color: '#6B7280', margin: '20px 0' }}>
            Ничего не найдено
          </p>
        )}
      </AnimatedSection>

      {/* Секция "Сервисы" */}
      <AnimatedSection
        title="Сервисы"
        icon="🛠️"
        iconBg="#F0FDF4"
        iconColor="#16A34A"
        visible={showServices && filteredServiceCards.length > 0}
      >
        <div style={gridStyle}>
          {filteredServiceCards.map(card => (
            <ReportCard
              key={card.to}
              {...card}
              isFavorite={favorites.includes(card.to)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
        {filteredServiceCards.length === 0 && (
          <p style={{ textAlign: 'center', color: '#6B7280', margin: '20px 0' }}>
            Ничего не найдено
          </p>
        )}
      </AnimatedSection>
    </div>
  );
}